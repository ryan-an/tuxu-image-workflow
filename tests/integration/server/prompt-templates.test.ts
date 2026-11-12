import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, loginHeaders, pairs } from "../../support/production.js";
import { Provisioning } from "../../../server/production/provisioning.js";
import { portableBackup } from "../../../src/services/backup.js";
import {
  DEFAULT_COMMON,
  productRequirements,
} from "../../../shared/prompt-suite.js";
import { createRequirementCommands } from "../../../src/application/requirements.js";
import { newProduct } from "../../../shared/model.js";
import { editable } from "../../../shared/workspace-edits.js";

test("template saves bind the current product atomically, survive restart, and leave other products unchanged", async () => {
  const f = await fixture();
  try {
    const state = await f.workflows.repo.view();
    const commands = createRequirementCommands({
      canEdit: true,
      state,
      repository: {
        async save() {},
        edit: (edits: any[]) => f.workflows.edit(edits),
        async refresh() {},
      },
    });
    const template = {
      id: "bound",
      name: "已绑定模板",
      content: state.common,
      updatedAt: 1,
    };
    await assert.rejects(
      commands.savePromptTemplate(template, null, {
        id: "missing-product",
        before: null,
        beforeTemplateId: null,
      }),
    );
    assert.deepEqual((await f.workflows.repo.view()).promptTemplates, {});
    assert.equal(
      (await f.workflows.repo.view()).products[0].promptTemplateId,
      null,
    );
    await commands.savePromptTemplate(template, null, {
      id: f.product.id,
      before: null,
      beforeTemplateId: null,
    });
    const other = {
      ...newProduct("BOUND-OTHER"),
      promptRequirements: template.content,
      promptTemplateId: template.id,
    };
    await f.workflows.edit([
      {
        path: ["products", other.id],
        before: null,
        value: editable({ ...state, products: [other] }).products[other.id],
      },
    ]);
    const updated = {
      ...template,
      content: "当前产品更新的正文",
      updatedAt: 2,
    };
    await commands.savePromptTemplate(updated, template, {
      id: f.product.id,
      before: template.content,
      beforeTemplateId: template.id,
    });
    const copy = {
      ...updated,
      id: "copy",
      name: "另存模板",
      content: "另存正文",
    };
    await commands.savePromptTemplate(copy, null, {
      id: f.product.id,
      before: updated.content,
      beforeTemplateId: updated.id,
    });
    await f.reopen();
    const saved = await f.workflows.repo.view();
    const current = saved.products.find((p) => p.id === f.product.id)!;
    const unchanged = saved.products.find((p) => p.id === other.id)!;
    assert.equal(current.promptTemplateId, copy.id);
    assert.equal(current.promptRequirements, copy.content);
    assert.deepEqual(saved.promptTemplates[copy.id], copy);
    assert.equal(unchanged.promptTemplateId, template.id);
    assert.equal(unchanged.promptRequirements, template.content);
  } finally {
    await f.close();
  }
});

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
      {
        path: ["products", f.product.id, "promptTemplateId"],
        before: null,
        value: template.id,
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
    assert.equal(state.products[0].promptTemplateId, template.id);
    assert.equal(state.jobs[0].common, template.content);
    await f.workflows.edit([
      { path: ["promptTemplates", template.id], before: updated, value: null },
    ]);
    const after = await f.workflows.repo.view();
    assert.deepEqual(after.promptTemplates, {});
    assert.equal(after.products[0].promptRequirements, template.content);
    assert.equal(after.products[0].promptTemplateId, template.id);
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
      {
        path: ["products", f.product.id, "promptRequirements"],
        before: null,
        value: template.content,
      },
      {
        path: ["products", f.product.id, "promptTemplateId"],
        before: null,
        value: template.id,
      },
    ]);
    const team = await new Provisioning(f.db).provisionTeam({
      username: "templates_other",
      password: "test-password-templates",
      workspaceName: "模板隔离测试",
    });
    const other = await f.workspaces.get(team.workspaceId);
    assert.deepEqual((await other.repo.view()).promptTemplates, {});
    assert.equal((await other.repo.view()).common, "");
    const exported = await f.workflows.repo.view();
    exported.products[0].photo = "";
    exported.products[0].photos = [];
    delete exported.products[0].photoThumbnail;
    // IDs are global in this database; emulate restore into an unused ID range.
    exported.products[0].id = randomUUID();
    for (const task of exported.products[0].tasks) {
      task.id = randomUUID();
      task.references = [];
    }
    const backup = await portableBackup({
      ...exported,
      common: DEFAULT_COMMON,
      jobs: [],
    });
    await other.importWorkspace(randomUUID(), backup);
    assert.deepEqual(
      (await other.repo.view()).promptTemplates[template.id],
      template,
    );
    const imported = await other.repo.view();
    assert.equal(imported.common, "");
    assert.equal(imported.products[0].promptTemplateId, template.id);
    assert.equal(
      productRequirements(imported.products[0], imported.common),
      template.content,
    );
    const legacyTeam = await new Provisioning(f.db).provisionTeam({
      username: "templates_legacy",
      password: "test-password-templates",
      workspaceName: "旧备份测试",
    });
    const legacy = await f.workspaces.get(legacyTeam.workspaceId);
    delete backup.promptTemplates;
    backup.products[0].id = randomUUID();
    for (const task of backup.products[0].tasks) task.id = randomUUID();
    await legacy.importWorkspace(randomUUID(), backup);
    assert.deepEqual((await legacy.repo.view()).promptTemplates, {});
  } finally {
    await f.close();
  }
});
