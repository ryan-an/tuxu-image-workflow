import test from "node:test";
import assert from "node:assert/strict";
import { ROLES, newProduct } from "../../../shared/model.js";
import { normalizePromptRole } from "../../../shared/prompt-roles.js";
import {
  parseSuiteResponse,
  PromptValidationError,
  suiteInstruction,
} from "../../../shared/prompt-suite.js";

// Same role spellings as the locally recorded failure, without product content.
const returnedRoles = [
  "尺寸图",
  "卖点图",
  "细节图",
  "场景1",
  "场景2",
  "场景3",
  "A+(1)",
  "A+(2)",
  "A+(3)",
  "A+(4)",
];
const suite = () => ({
  images: returnedRoles.map((role, index) => ({
    role,
    prompt: `第一部分：布局 ${index}\nCopy ${index}\n第二部分：设计规范\n第三部分：约束 ${index}\n第四部分：尺寸 ${index}`,
    photoIndices: [index % 2],
  })),
});

test("recorded role variants map to the standard cards even when returned out of order", () => {
  const response = suite();
  response.images.reverse();
  const result = parseSuiteResponse(JSON.stringify(response), 2);

  assert.deepEqual(
    result.prompts.map((item: { role: string }) => item.role),
    ROLES,
  );
  for (const [index, item] of result.prompts.entries()) {
    assert.equal(item.prompt, suite().images[index].prompt);
    assert.deepEqual(item.photoIndices, [index % 2]);
  }
});

test("role typography accepts whitespace, parentheses and full-width characters only for known cards", () => {
  for (const [input, expected] of [
    [" 场景\u00a01 ", "场景 1"],
    ["场景（２）", "场景 2"],
    [" A＋（４） ", "A+ 4"],
    ["a+ 3", "A+ 3"],
    ["\n尺寸图\t", "尺寸图"],
  ])
    assert.equal(normalizePromptRole(input), expected);
  for (const input of [
    undefined,
    null,
    1,
    {},
    "",
    "未知位置",
    "场景4",
    "A+(5)",
    "A+(1",
    "A+1/2",
    "第7张",
  ])
    assert.equal(normalizePromptRole(input), undefined);
});

test("equivalent duplicate roles still reject the whole suite and identify the repeated card", () => {
  const response = suite();
  response.images[7].role = "A+ 1";
  assert.throws(
    () => parseSuiteResponse(JSON.stringify(response)),
    (error: unknown) =>
      error instanceof PromptValidationError &&
      error.code === "invalid_card" &&
      error.role === "A+ 1" &&
      error.message.includes("重复"),
  );
});

test("single-card requests accept equivalent names without accepting another card by array order", () => {
  const product = newProduct("single-card");
  product.tasks = product.tasks.slice(7, 8);
  const response = suite();
  response.images = [response.images[7]];
  assert.equal(
    parseSuiteResponse(JSON.stringify(response), 0, product).prompts[0].role,
    "A+ 2",
  );
  response.images[0].role = "尺寸图";
  assert.throws(
    () => parseSuiteResponse(JSON.stringify(response), 0, product),
    (error: unknown) =>
      error instanceof PromptValidationError && error.code === "invalid_card",
  );
});

test("missing and unknown roles are not filled in from their array positions", () => {
  const response = suite();
  response.images[9].role = "未知位置";
  assert.throws(
    () => parseSuiteResponse(JSON.stringify(response)),
    (error: unknown) =>
      error instanceof PromptValidationError && error.code === "invalid_card",
  );
  response.images.pop();
  assert.throws(
    () => parseSuiteResponse(JSON.stringify(response)),
    (error: unknown) =>
      error instanceof PromptValidationError &&
      error.code === "incomplete_suite",
  );
});

test("single-card instructions demonstrate the requested role rather than the size card", () => {
  const product = newProduct("single-card");
  product.tasks = product.tasks.slice(7, 8);
  const instruction = suiteInstruction(product, "用户当前要求");

  assert.ok(instruction.includes('"role":"A+ 2"'));
  assert.ok(!instruction.includes('"role":"尺寸图"'));
  assert.match(instruction, /每项role必须逐字使用上述卡片名称/);
  assert.match(instruction, /由你在每张prompt内完整写出四部分/);
  assert.match(instruction, /不再添加标题、重排或拼接各部分/);
});
