import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, loginHeaders, pairs } from "../../support/production.js";
import { Provisioning } from "../../../server/production/provisioning.js";
import { portableBackup } from "../../../src/services/backup.js";

test("text templates persist, accept latest saves, and never change applied product or queued text", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const template = {
      id: randomUUID(),
      name: "暖色版",
      content: "背景暖白。产品不得变形。",
      updatedAt: Date.now(),
    };
    const patch = (before: any, value: any) =>
      f.app.inject({
        method: "PATCH",
        url: "/api/workspace",
        headers,
        payload: {
          edits: [{ path: ["promptTemplates", template.id], before, value }],
        },
      });
    assert.equal((await patch(null, template)).statusCode, 200);
    const defaults = (await f.workflows.repo.view()).common;
    assert.equal(
      (await f.workflows.repo.view()).products[0].promptRequirements,
      null,
    );
    await f.workflows.edit([
      {
        path: ["products", f.product.id, "promptRequirements"],
        before: null,
        value: template.content,
      },
    ]);
    await f.workflows.enqueue(randomUUID(), pairs(f.product), "prompt-set");
    const updated = { ...template, name: "冷色版", content: "背景冷灰。" };
    assert.equal((await patch(template, updated)).statusCode, 200);
    assert.equal(
      (await patch(template, { ...template, content: "过期编辑" })).statusCode,
      200,
    );
    assert.equal(
      (await f.workflows.repo.view()).promptTemplates[template.id].content,
      "过期编辑",
    );
    await patch(template, updated);
    for (const value of [
      { ...updated, name: " " },
      { ...updated, content: " " },
      { ...updated, content: "x".repeat(100001) },
      { ...updated, updatedAt: -1 },
      { ...updated, id: "mismatch" },
    ])
      assert.equal((await patch(updated, value)).statusCode, 400);
    const duplicate = await f.app.inject({
      method: "PATCH",
      url: "/api/workspace",
      headers,
      payload: {
        edits: [
          {
            path: ["promptTemplates", "duplicate"],
            before: null,
            value: { ...updated, id: "duplicate" },
          },
        ],
      },
    });
    assert.equal(duplicate.statusCode, 400);
    await f.reopen();
    const state = await f.workflows.repo.view();
    assert.deepEqual(state.promptTemplates[template.id], updated);
    assert.equal(state.common, defaults);
    assert.equal(state.products[0].promptRequirements, template.content);
    assert.equal(state.jobs[0].common, template.content);
    await f.workflows.edit([
      { path: ["promptTemplates", template.id], before: updated, value: null },
    ]);
    const after = await f.workflows.repo.view();
    assert.deepEqual(after.promptTemplates, {});
    assert.equal(after.products[0].promptRequirements, template.content);
  } finally {
    await f.close();
  }
});

test("templates are scoped to a workspace and travel with portable backups, including legacy imports", async () => {
  const f = await fixture();
  try {
    const template = {
      id: randomUUID(),
      name: "通用版",
      content: "自由文本，不需要固定标题。",
      updatedAt: Date.now(),
    };
    await f.workflows.edit([
      { path: ["promptTemplates", template.id], before: null, value: template },
    ]);
    const team = await new Provisioning(f.db).provisionTeam({
      username: "templates_other",
      password: "test-password-templates",
      workspaceName: "模板隔离测试",
    });
    const other = await f.workspaces.get(team.workspaceId);
    assert.deepEqual((await other.repo.view()).promptTemplates, {});
    const backup = await portableBackup({
      ...(await f.workflows.repo.view()),
      products: [],
      jobs: [],
    });
    await other.importWorkspace(randomUUID(), backup);
    assert.deepEqual(
      (await other.repo.view()).promptTemplates[template.id],
      template,
    );
    const legacyTeam = await new Provisioning(f.db).provisionTeam({
      username: "templates_legacy",
      password: "test-password-templates",
      workspaceName: "旧备份测试",
    });
    const legacy = await f.workspaces.get(legacyTeam.workspaceId);
    delete backup.promptTemplates;
    await legacy.importWorkspace(randomUUID(), backup);
    assert.deepEqual((await legacy.repo.view()).promptTemplates, {});
  } finally {
    await f.close();
  }
});
