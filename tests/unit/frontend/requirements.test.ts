import test from "node:test";
import assert from "node:assert/strict";
import { newProduct } from "../../../shared/model.js";
import {
  suiteInstruction,
  parseSuiteResponse,
  productRequirements,
  DEFAULT_COMMON,
  LEGACY_DEFAULT_COMMON,
  migrateDefaultCommon,
} from "../../../shared/prompt-suite.js";
import { createRequirementCommands } from "../../../src/application/requirements.js";
import {
  requirementDraftKey,
  readRequirementDraft,
  writeRequirementDraft,
  readRequirementPosition,
  writeRequirementPosition,
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
    images: [
      {
        role: product.tasks[0].role,
        prompt: "产品居中\nSimple\n浅灰\n保持外观\n1200×800",
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
  response.images[0].prompt = "模型给出的正文";
  assert.equal(
    parseSuiteResponse(
      JSON.stringify(response),
      0,
      product,
      text,
    ).prompts[0].prompt.includes(text),
    false,
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
  writeRequirementDraft(
    key,
    "相同正文",
    "相同正文",
    "template:custom",
    "default",
  );
  assert.deepEqual(readRequirementDraft(key), {
    content: "相同正文",
    base: "相同正文",
    templateChoice: "template:custom",
    baseTemplateChoice: "default",
  });
  writeRequirementDraft(
    key,
    "相同正文",
    "相同正文",
    "template:custom",
    "template:custom",
  );
  assert.equal(readRequirementDraft(key), null);
  const alternatives = {
    "": "原来的手写草稿",
    "template:other": "另一模板单独编辑的正文",
  };
  writeRequirementDraft(
    key,
    "已保存模板正文",
    "已保存模板正文",
    "template:current",
    "template:current",
    { ...alternatives, "template:current": "已保存模板正文" },
  );
  assert.deepEqual(readRequirementDraft(key), {
    content: "已保存模板正文",
    base: "已保存模板正文",
    templateChoice: "template:current",
    baseTemplateChoice: "template:current",
    templateDrafts: alternatives,
  });
  assert.equal(readRequirementDraft(requirementDraftKey(user, "other")), null);
  writeRequirementDraft(
    key,
    "已保存模板正文",
    "已保存模板正文",
    "template:current",
    "template:current",
  );
  assert.equal(readRequirementDraft(key), null);

  const position = {
    start: 12,
    end: 18,
    direction: "backward",
    scrollTop: 240,
    scrollLeft: 0,
  };
  writeRequirementPosition(key, "", position);
  writeRequirementDraft(key, "已保存", "已保存");
  assert.deepEqual(readRequirementPosition(key, ""), position);
  assert.equal(readRequirementPosition(key, "template:other"), null);
  for (const other of [
    { ...user, id: "bob" },
    { ...user, workspaceId: "two" },
  ])
    assert.equal(
      readRequirementPosition(requirementDraftKey(other, "product"), ""),
      null,
    );
  assert.equal(
    readRequirementPosition(requirementDraftKey(user, "other"), ""),
    null,
  );
  writeRequirementPosition(key, "template:other", { ...position, start: -1 });
  assert.equal(readRequirementPosition(key, "template:other"), null);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("Storage unavailable");
    },
  });
  assert.equal(readRequirementPosition(key, ""), null);
  assert.doesNotThrow(() => writeRequirementPosition(key, "", position));
});

test("unconfigured requirements start empty and old automatic defaults retire without changing custom text", () => {
  const state = emptyWorkspace();
  const product: any = newProduct("empty-requirements");
  assert.equal(state.common, "");
  assert.equal(product.promptTemplateId, null);
  assert.equal(productRequirements(product), "");
  assert.equal(productRequirements(product, state.common), "");
  for (const text of [DEFAULT_COMMON, LEGACY_DEFAULT_COMMON])
    assert.equal(migrateDefaultCommon(text.replace(/\n/g, "\r\n")), "");
  assert.equal(migrateDefaultCommon("已保存的共用要求"), "已保存的共用要求");
  product.promptRequirements = DEFAULT_COMMON;
  assert.equal(productRequirements(product, ""), DEFAULT_COMMON);
});

test("saving requirements always freezes product text and template source independently", async () => {
  const state = emptyWorkspace();
  state.common = DEFAULT_COMMON;
  const product = newProduct("bound-template");
  state.products = [product as any];
  const commands = createRequirementCommands({
    canEdit: true,
    state,
    change() {},
    notify() {},
    persist: async () => {},
  });
  const original = state.common;
  await commands.saveProductRequirements(
    product.id,
    original,
    null,
    "template",
    null,
  );
  assert.equal(product.promptTemplateId, "template");
  assert.equal(product.promptRequirements, original);
  state.common = "默认要求后来发生变化";
  assert.equal(productRequirements(product, state.common), original);
  await assert.rejects(
    commands.saveProductRequirements(
      product.id,
      " \n ",
      original,
      "template",
      "template",
    ),
    /请填写生成要求/,
  );
  assert.equal(product.promptRequirements, original);
  await commands.saveProductRequirements(
    product.id,
    state.common,
    original,
    null,
    "template",
  );
  assert.equal(product.promptTemplateId, null);
  assert.equal(product.promptRequirements, state.common);
  state.common = "共用要求再次变化";
  assert.equal(product.promptRequirements, "默认要求后来发生变化");
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
