import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  loginHeaders,
  fakeProvider,
  counts,
  png,
} from "../../support/production.js";
import { Admin } from "../../../server/production/admin.js";
import { WorkspaceDirectory } from "../../../server/production/workspace-directory.js";
import { Worker } from "../../../server/production/worker.js";
import { newProduct } from "../../../shared/model.js";
import { differences, editable } from "../../../shared/workspace-edits.js";
import type { Product } from "../../../server/production/types.js";

test("nonmember management configuration, image generation and auditing use the target workspace and real administrator", async () => {
  const f = await fixture();
  try {
    const admin = new Admin(f.db, "owner", "configuration-setup");
    const person = await admin.createAccount({
      username: "config-owner",
      displayName: "空间主人",
      password: "configuration-password-123",
    });
    const { id } = await admin.createWorkspace({
      name: "独立配置空间",
      ownerId: person.id,
    });
    const headers = {
      ...(await loginHeaders(f.app)),
      "x-workspace-id": id,
      "x-admin-mode": "1",
    };
    const actor = (await new WorkspaceDirectory(f.db).context(
      "owner",
      id,
      true,
    ))!;
    const runtime = await f.workspaces.get(id);
    const beforeDefault = await f.workflows.settings();
    const credentials = await f.app.inject({
      method: "POST",
      url: "/api/workflow/credentials",
      headers,
      payload: {
        apiKey: "secret-management-image-key",
        promptApiKey: "secret-management-prompt-key",
      },
    });
    assert.equal(credentials.statusCode, 200, credentials.body);
    assert.equal(credentials.json().hasKey, true);
    assert.equal(credentials.body.includes("secret-management"), false);
    const settings = await f.app.inject({
      method: "POST",
      url: "/api/workflow/settings",
      headers,
      payload: {
        imageModel: "nano-banana-fast",
        aspectRatio: "1:1",
        promptModel: "management-conversation-model",
      },
    });
    assert.equal(settings.statusCode, 200, settings.body);
    assert.equal(
      (await runtime.settings(actor)).imageModel,
      "nano-banana-fast",
    );
    assert.deepEqual(
      await f.workflows.settings(),
      beforeDefault,
      "other workspace settings and keys remain independent",
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM admin_generation_settings WHERE workspace_id=$1 AND account_id='owner'",
          [id],
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id=$1 AND account_id='owner'",
          [id],
        )
      ).rows[0].count,
      0,
    );

    const old = await runtime.repo.view(),
      next = structuredClone(old);
    const product = newProduct(
      "ADMIN-IMAGE",
      "管理生成",
      "测试产品",
    ) as Product;
    product.photo = png;
    product.photos = [png];
    product.tasks[0].prompt = "A clean studio product photo";
    next.products.push(product);
    await runtime.edit(differences(editable(old), editable(next)), actor);
    const queued = await f.app.inject({
      method: "POST",
      url: "/api/jobs",
      headers,
      payload: {
        commandId: "admin-image-generation",
        kind: "image",
        pairs: [{ productId: product.id, taskId: product.tasks[0].id }],
      },
    });
    assert.equal(queued.statusCode, 200, queued.body);
    const pending = (await runtime.repo.view()).jobs[0];
    assert.equal(pending.createdBy?.id, "owner");
    assert.equal(pending.createdBy?.accessMode, "admin");
    assert.equal(pending.config.imageModel, "nano-banana-fast");
    const worker = new Worker(runtime, fakeProvider(counts()), () => {});
    assert.equal(await worker.step(), true);
    await f.due();
    assert.equal(await worker.step(), true);
    const completed = (await runtime.repo.view()).jobs[0];
    assert.equal(completed.status, "completed", completed.error);
    const detail = await admin.workspaceDetail(id);
    assert.equal(detail.usage.total, 1);
    assert.equal(detail.usage.administrator, 1);
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM account_usage WHERE workspace_id=$1",
          [id],
        )
      ).rows[0].count,
      0,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM account_usage WHERE workspace_id='default'",
        )
      ).rows[0].count,
      0,
    );

    const audit = await admin.auditLogs({ q: id });
    assert.ok(
      audit.items.some(
        (item) =>
          item.action === "workspace.credentials.update" &&
          item.actorId === "owner" &&
          item.requestId !== "internal",
      ),
    );
    assert.ok(
      audit.items.some(
        (item) =>
          item.action === "workspace.settings.update" &&
          item.changes.after?.imageModel === "nano-banana-fast",
      ),
    );
    assert.equal(JSON.stringify(audit).includes("secret-management"), false);
    const activity = (
      await f.db.query(
        "SELECT payload FROM workspace_activity WHERE workspace_id=$1",
        [id],
      )
    ).rows;
    assert.ok(activity.some((row) => row.payload.actor.id === "owner"));
  } finally {
    await f.close();
  }
});

test("a failed management configuration audit rolls back preferences and encrypted keys", async () => {
  const f = await fixture();
  try {
    const headers = {
      ...(await loginHeaders(f.app)),
      "x-workspace-id": "default",
      "x-admin-mode": "1",
    };
    const actor = (await new WorkspaceDirectory(f.db).context(
      "owner",
      "default",
      true,
    ))!;
    const before = await f.workflows.settings(actor);
    const oldKey = await f.workflows.key();
    await f.db.query(
      "CREATE TRIGGER reject_configuration_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action='workspace.credentials.update' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;",
    );
    const response = await f.app.inject({
      method: "POST",
      url: "/api/workflow/settings",
      headers,
      payload: {
        imageModel: "nano-banana-fast",
        apiKey: "must-not-be-committed",
      },
    });
    assert.equal(response.statusCode, 500, response.body);
    assert.deepEqual(await f.workflows.settings(actor), before);
    assert.equal(await f.workflows.key(), oldKey);
    await f.db.query("DROP TRIGGER reject_configuration_audit");
    const failed = (
      await f.db.query(
        "SELECT changes,error_code FROM admin_audit_logs WHERE result='failure'",
      )
    ).rows;
    assert.equal(failed.length, 1);
    assert.equal(failed[0].error_code, "HTTP_500");
    assert.equal(
      JSON.stringify(failed).includes("must-not-be-committed"),
      false,
    );
  } finally {
    await f.close();
  }
});

test("admin failure audits remain distinct across service restarts", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const fail = () =>
      f.app.inject({
        method: "PATCH",
        url: "/api/admin/accounts/owner",
        headers,
        payload: { displayName: " " },
      });
    const first = await fail();
    assert.equal(first.statusCode, 400);
    await f.reopen();
    assert.equal(
      (await f.app.inject({ url: "/api/admin/accounts", headers })).statusCode,
      200,
    );
    const second = await fail();
    assert.equal(second.statusCode, 400);
    assert.notEqual(first.json().requestId, second.json().requestId);
    const logs = (
      await f.db.query(
        "SELECT request_id FROM admin_audit_logs WHERE result='failure' AND target_account_id='owner'",
      )
    ).rows;
    assert.equal(logs.length, 2);
    assert.equal(new Set(logs.map((row) => row.request_id)).size, 2);
  } finally {
    await f.close();
  }
});
