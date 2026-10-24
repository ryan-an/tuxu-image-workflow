import test from "node:test";
import assert from "node:assert/strict";
import { newProduct } from "../../../shared/model.js";
import {
  suiteInstruction,
  parseSuiteResponse,
} from "../../../shared/prompt-suite.js";
import {
  requirementDraftKey,
  readRequirementDraft,
  writeRequirementDraft,
} from "../../../src/integrations/requirement-drafts.js";
import { WorkspaceClient } from "../../../src/services/workspace-client.js";
import { emptyWorkspace } from "../../../server/production/repository.js";

test("free text needs no numbered headings and model dimensions are not overridden by heading guesses", () => {
  const product = newProduct("free-text");
  product.tasks = product.tasks.slice(0, 1);
  const text = "设计说明\n用浅灰背景。产品约束：保持外观。画布 1200×800。";
  assert.ok(suiteInstruction(product, text).includes(text));
  assert.match(suiteInstruction(product, text), /标题、编号和段落格式不限/);
  const response = {
    style: "浅灰",
    images: [
      {
        role: product.tasks[0].role,
        layout: "产品居中",
        copy: ["Simple"],
        thirdPart: "保持外观",
        fourthPart: "1200×800",
      },
    ],
  };
  const result = parseSuiteResponse(JSON.stringify(response), 0, product, text);
  assert.match(result.prompts[0].prompt, /保持外观/);
  assert.match(result.prompts[0].prompt, /1200×800/);
  const custom =
    "第三部分：我改用这个标题记录文案\n第四部分：草案 100×100，但实际请用1200×800";
  assert.match(
    parseSuiteResponse(JSON.stringify(response), 0, product, custom).prompts[0]
      .prompt,
    /1200×800/,
  );
  delete (response.images[0] as any).thirdPart;
  assert.ok(
    parseSuiteResponse(
      JSON.stringify(response),
      0,
      product,
      text,
    ).prompts[0].prompt.includes(text),
  );
});

test("drafts survive reload, clear after save, and use separate user, workspace and product keys", (t) => {
  const storage = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete (globalThis as any).localStorage;
  });
  const user = { workspaceId: "one", id: "alice" };
  const key = requirementDraftKey(user, "product");
  assert.equal(writeRequirementDraft(key, "草稿", "原文"), true);
  assert.deepEqual(readRequirementDraft(key), {
    content: "草稿",
    base: "原文",
  });
  assert.equal(
    readRequirementDraft(
      requirementDraftKey({ ...user, id: "bob" }, "product"),
    ),
    null,
  );
  assert.equal(
    readRequirementDraft(
      requirementDraftKey({ ...user, workspaceId: "two" }, "product"),
    ),
    null,
  );
  assert.equal(readRequirementDraft(requirementDraftKey(user, "other")), null);
  writeRequirementDraft(key, "已保存", "已保存");
  assert.equal(readRequirementDraft(key), null);
});

test("dialog saves keep unrelated pending edits and preserve the original conflict baseline", async (t) => {
  const state = emptyWorkspace();
  state.products = [newProduct("one") as any];
  const client = new WorkspaceClient(state, {
    render() {},
    sync() {},
    notify() {},
  });
  const remote = structuredClone(state);
  const template = {
    id: "template",
    name: "模板",
    content: "自由文本",
    updatedAt: 1,
  };
  remote.promptTemplates = { template };
  state.products[0].facts = "还未提交的资料";
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify(remote), {
        headers: { "Content-Type": "application/json" },
      }),
  );
  await client.edit([
    { path: ["promptTemplates", "template"], before: null, value: template },
  ]);
  assert.deepEqual(state.promptTemplates, { template });
  assert.equal(state.products[0].facts, "还未提交的资料");
  assert.equal(client.baseline.products[0].facts, remote.products[0].facts);
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ error: "已更新，请保留草稿" }), {
        status: 409,
      }),
  );
  await assert.rejects(client.edit([]), /请保留草稿/);
  assert.equal(state.products[0].facts, "还未提交的资料");
});
