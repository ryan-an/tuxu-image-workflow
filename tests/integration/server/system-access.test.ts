import test from "node:test";
import assert from "node:assert/strict";
import { fixture, loginHeaders, png } from "../../support/production.js";
import { Members } from "../../../server/production/members.js";
import { Accounts } from "../../../server/production/accounts.js";
import { WorkspaceDirectory } from "../../../server/production/workspace-directory.js";
import { requireMembership } from "../../../server/production/workspace-access.js";
import {
  assertImageQuota,
  recordImageSuccess,
} from "../../../server/production/account-usage.js";
import type { Job } from "../../../server/production/types.js";
import { can } from "../../../shared/access.js";

async function independentWorkspace(f: Awaited<ReturnType<typeof fixture>>) {
  const person = await new Members(f.db).create({
    username: "independent-person",
    displayName: "工作区所有者",
    role: "editor",
    password: "independent-password-123",
    monthlyLimit: null,
  });
  const directory = new WorkspaceDirectory(f.db);
  const { id } = await directory.create(person.id, "独立空间");
  return { person, directory, id };
}

test("system role is independent of membership; explicit admin access is checked again in transactions", async () => {
  const f = await fixture();
  try {
    const { person, directory, id } = await independentWorkspace(f);
    assert.equal(await directory.context("owner", id), null);
    const admin = (await directory.context("owner", id, true))!;
    assert.equal(admin.systemRole, "super_admin");
    assert.equal(admin.accessMode, "admin");
    assert.equal(
      admin.role,
      "viewer",
      "management does not manufacture ownership",
    );
    assert.equal(can(admin, "manage"), true);
    assert.equal(
      (
        await f.db.query(
          "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND account_id='owner'",
          [id],
        )
      ).rows.length,
      0,
    );
    await f.db.transaction((tx) => requireMembership(tx, id, admin, "manage"));
    await assert.rejects(
      f.db.transaction((tx) => requireMembership(tx, id, "owner", "manage")),
      /所有者/,
    );
    const forged = {
      ...admin,
      id: person.id,
      systemRole: "super_admin" as const,
    };
    await assert.rejects(
      f.db.transaction((tx) => requireMembership(tx, id, forged, "manage")),
      /管理身份/,
    );
    await assert.rejects(
      f.db.transaction((tx) => requireMembership(tx, "default", admin, "edit")),
      /上下文/,
    );
    await f.db.query("UPDATE accounts SET system_role='user' WHERE id='owner'");
    await assert.rejects(
      f.db.transaction((tx) => requireMembership(tx, id, admin, "edit")),
      /管理身份/,
    );
  } finally {
    await f.close();
  }
});

test("HTTP, session refresh and native images authorize nonmember administrators and keep archive read-only", async () => {
  const f = await fixture();
  try {
    const { person, directory, id } = await independentWorkspace(f);
    const headers = await loginHeaders(f.app);
    const scope = { ...headers, "x-workspace-id": id, "x-admin-mode": "1" };
    const runtime = await f.workspaces.get(id);
    const asset = await runtime.assets.normalize(png);
    assert.equal(
      (
        await f.app.inject({
          url: "/api/workspace",
          headers: { ...headers, "x-workspace-id": id },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: scope }))
        .statusCode,
      200,
    );
    assert.equal((await f.app.inject({ url: asset, headers })).statusCode, 404);
    const imageHeaders = {
      ...headers,
      referer: `http://localhost/?workspace=${id}&admin=1`,
    };
    assert.equal(
      (await f.app.inject({ url: asset, headers: imageHeaders })).statusCode,
      200,
    );
    assert.equal(
      (
        await f.app.inject({
          url: `${asset}?workspace=${id}&admin=1&account=owner`,
          headers,
        })
      ).statusCode,
      200,
    );
    for (const referer of [
      `https://external.invalid/?workspace=${id}&admin=1`,
      "invalid-referrer",
    ])
      assert.equal(
        (await f.app.inject({ url: asset, headers: { ...headers, referer } }))
          .statusCode,
        404,
      );
    assert.equal(
      (
        await f.app.inject({
          url: asset,
          headers: { ...imageHeaders, "x-workspace-id": "default" },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await f.app.inject({
          url: asset,
          headers: { ...headers, "x-workspace-id": "default" },
        })
      ).statusCode,
      404,
    );
    const session = await f.app.inject({
      url: `/api/auth/session?workspace=${id}&admin=1`,
      headers,
    });
    assert.equal(session.json().user.accessMode, "admin");
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM admin_audit_logs WHERE action='workspace.access' AND workspace_id=$1",
          [id],
        )
      ).rows[0].count,
      1,
    );
    await f.app.inject({ url: "/api/workspace", headers: scope });
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM admin_audit_logs WHERE action='workspace.access' AND workspace_id=$1",
          [id],
        )
      ).rows[0].count,
      1,
      "ordinary management requests do not duplicate entry logs",
    );
    const credentials = await new Accounts(f.db).authenticate(
      "independent-person",
      "independent-password-123",
    );
    const { token } = await new Accounts(f.db).createSession(credentials);
    assert.equal(
      (
        await f.app.inject({
          url: "/api/workspace",
          headers: {
            cookie: `tuxu_session=${token}`,
            "x-workspace-id": id,
            "x-admin-mode": "1",
          },
        })
      ).statusCode,
      403,
    );
    await directory.archive(person.id, id, true);
    const archived = (await directory.context("owner", id, true))!;
    assert.ok(archived.archivedAt);
    assert.equal(can(archived, "edit"), false);
    for (const url of [
      "/api/members",
      "/api/member-invitations",
      "/api/workflow/settings",
    ])
      assert.equal(
        (await f.app.inject({ url, headers: scope })).statusCode,
        200,
        url,
      );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: scope }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workflow/settings",
          headers: scope,
          payload: { imageModel: "nano-banana-2" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await f.app.inject({ url: asset, headers: imageHeaders })).statusCode,
      200,
    );
    await assert.rejects(
      f.db.transaction((tx) => requireMembership(tx, id, archived, "edit")),
      /归档/,
    );
    await f.db.query("UPDATE accounts SET system_role='user' WHERE id='owner'");
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: scope }))
        .statusCode,
      403,
    );
    assert.equal(
      (await f.app.inject({ url: asset, headers: imageHeaders })).statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});

test("unaccepted memberships cannot gain access through an active status alone", async () => {
  const f = await fixture();
  try {
    const { person, directory, id } = await independentWorkspace(f);
    await f.db.query(
      "UPDATE workspace_members SET accepted_at=NULL WHERE workspace_id=$1 AND account_id=$2",
      [id, person.id],
    );
    assert.equal(await directory.context(person.id, id), null);
    assert.equal(
      (await directory.list(person.id)).some(
        (workspace) => workspace.id === id,
      ),
      false,
    );
    await assert.rejects(
      f.db.transaction((tx) => requireMembership(tx, id, person.id, "manage")),
      /所有者/,
    );
    assert.equal(
      (await directory.context("owner", id, true))?.accessMode,
      "admin",
    );
  } finally {
    await f.close();
  }
});

test("administrator image attribution is separate, atomic and idempotent without implicit membership", async () => {
  const f = await fixture();
  try {
    const { directory, id } = await independentWorkspace(f);
    const admin = (await directory.context("owner", id, true))!;
    await f.db.transaction((tx) => assertImageQuota(tx, admin, id));
    const job = {
      id: "admin-completed-image",
      kind: "image",
      status: "completed",
      finishedAt: Date.now(),
      createdBy: admin,
      productId: "usage-fixture",
      productName: "计量产品",
      stage: "已完成",
      config: {},
      role: "主图",
      mode: "live",
      createdAt: Date.now(),
      error: "",
    } satisfies Job;
    await f.db.transaction((tx) => recordImageSuccess(tx, job, id));
    await f.db.transaction((tx) => recordImageSuccess(tx, job, id));
    await f.db.transaction((tx) =>
      recordImageSuccess(
        tx,
        { ...job, createdBy: { ...admin, accessMode: "member" } },
        id,
      ),
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT used FROM admin_usage WHERE workspace_id=$1 AND account_id='owner'",
          [id],
        )
      ).rows[0].used,
      1,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT 1 FROM account_usage WHERE workspace_id=$1 AND account_id='owner'",
          [id],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND account_id='owner'",
          [id],
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await recordImageSuccess(tx, { ...job, id: "rolled-back-image" }, id);
        throw new Error("abort transaction");
      }),
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT used FROM admin_usage WHERE workspace_id=$1 AND account_id='owner'",
          [id],
        )
      ).rows[0].used,
      1,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT 1 FROM admin_image_usage WHERE job_id='rolled-back-image'",
        )
      ).rows.length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("nonmember administrator SSE access is rechecked when the role or session is revoked", async () => {
  const f = await fixture();
  const abort = new AbortController();
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  try {
    const { person, id } = await independentWorkspace(f);
    const headers = await loginHeaders(f.app);
    const runtime = await f.workspaces.get(id);
    await f.app.listen({ host: "127.0.0.1", port: 0 });
    const origin = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
    const openStream = async () => {
      const response = await fetch(
        `${origin}/api/workspace/events?workspace=${id}&account=owner&admin=1`,
        {
          headers,
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
        },
      );
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get("content-type") || "",
        /text\/event-stream/,
      );
      const reader = response.body!.getReader();
      readers.push(reader);
      assert.equal((await reader.read()).done, false);
      return reader;
    };
    const roleStream = await openStream();
    await f.db.query("UPDATE accounts SET system_role='user' WHERE id='owner'");
    runtime.collaboration.changed();
    while (!(await roleStream.read()).done) {
      /* Drain already-buffered events. */
    }
    await f.db.query(
      "UPDATE accounts SET system_role='super_admin' WHERE id='owner'",
    );
    const sessionStream = await openStream();
    await f.db.query("DELETE FROM account_sessions WHERE account_id='owner'");
    runtime.collaboration.changed();
    while (!(await sessionStream.read()).done) {
      /* Drain already-buffered events. */
    }
    const accounts = new Accounts(f.db);
    const credentials = await accounts.authenticate(
      "independent-person",
      "independent-password-123",
    );
    const { token } = await accounts.createSession(credentials);
    const forged = await fetch(
      `${origin}/api/workspace/events?workspace=${id}&account=${person.id}&admin=1`,
      {
        headers: { cookie: `tuxu_session=${token}` },
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
      },
    );
    assert.equal(forged.status, 403);
    await forged.body?.cancel();
  } finally {
    abort.abort();
    await Promise.all(readers.map((reader) => reader.cancel().catch(() => {})));
    await f.close();
  }
});

test("pending management jobs do not reserve a member's image allowance", async () => {
  const f = await fixture();
  try {
    const { person, directory } = await independentWorkspace(f);
    await directory.transfer("owner", "default", person.id);
    await f.db.query(
      "UPDATE workspace_members SET monthly_limit=1 WHERE workspace_id='default' AND account_id='owner'",
    );
    const member = (await directory.context("owner", "default"))!;
    const administrator = (await directory.context("owner", "default", true))!;
    const pending = (id: string, actor = member): Job => ({
      id,
      productId: f.product.id,
      productName: f.product.name,
      kind: "image",
      status: "queued",
      stage: "queued",
      config: {},
      role: "主图",
      mode: "live",
      createdAt: Date.now(),
      error: "",
      createdBy: actor,
    });
    await f.db.transaction(async (tx) => {
      await f.workflows.repo.insertJob(
        tx,
        pending("administrator-pending-one", administrator),
      );
      await f.workflows.repo.insertJob(
        tx,
        pending("administrator-pending-two", administrator),
      );
      await assertImageQuota(tx, member, "default");
      await f.workflows.repo.insertJob(tx, pending("member-pending-one"));
      await assertImageQuota(tx, member, "default");
    });
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await f.workflows.repo.insertJob(tx, pending("member-pending-two"));
        await assertImageQuota(tx, member, "default");
      }),
      /额度不足/,
    );
    await f.db.transaction((tx) =>
      assertImageQuota(tx, administrator, "default"),
    );
  } finally {
    await f.close();
  }
});
