import test from "node:test";
import assert from "node:assert/strict";
import { newProduct } from "../../../shared/model.js";
import { validateProduct } from "../../../server/production/workflows.js";
import { AppError, type Product } from "../../../server/production/types.js";

test("product validation names each invalid field and logs no product text", () => {
  const cases: [string, string, (product: Product) => void][] = [
    ["invalid_product_id", "产品标识格式无效", (p) => (p.id = "bad id")],
    ["invalid_code", "产品编号必须是文字", (p) => (p.code = 123 as any)],
    ["empty_code", "产品编号不能为空", (p) => (p.code = " \t ")],
    ["invalid_name", "产品名称必须是文字", (p) => (p.name = null as any)],
    ["empty_name", "产品名称不能为空", (p) => (p.name = " \n ")],
    [
      "invalid_facts",
      "产品资料必须是文字",
      (p) => (p.facts = undefined as any),
    ],
    [
      "invalid_requirements",
      "本产品生成要求必须是文字",
      (p) => (p.promptRequirements = {} as any),
    ],
    [
      "empty_requirements",
      "本产品生成要求不能为空",
      (p) => (p.promptRequirements = " \n "),
    ],
    [
      "requirements_too_long",
      "本产品生成要求不能超过 100000 字",
      (p) => (p.promptRequirements = "私".repeat(100001)),
    ],
    [
      "invalid_prompt_template",
      "提示词模板标识无效",
      (p) => (p.promptTemplateId = "bad template id"),
    ],
    ["invalid_tasks", "图片位置列表格式无效", (p) => (p.tasks = null as any)],
    [
      "invalid_task_count",
      "图片位置应为 10 个，当前为 9 个",
      (p) => p.tasks.pop(),
    ],
    ["invalid_task", "图片位置数据格式无效", (p) => (p.tasks[0] = null as any)],
    [
      "duplicate_task_ids",
      "图片位置标识重复",
      (p) => (p.tasks[1].id = p.tasks[0].id),
    ],
    [
      "duplicate_task_roles",
      "图片位置类型重复",
      (p) => (p.tasks[1].role = p.tasks[0].role),
    ],
  ];
  for (const [reason, message, mutate] of cases) {
    const product = newProduct(
      "PRIVATE-CODE",
      "私人名称",
      "私人资料",
    ) as Product;
    product.promptRequirements = "私人生成要求";
    mutate(product);
    assert.throws(
      () => validateProduct(product),
      (error) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 400);
        assert.ok(error.message.includes(message), error.message);
        assert.deepEqual(error.diagnostic?.reasons, [reason]);
        assert.equal(error.diagnostic?.event, "product.validation.failed");
        const diagnostic = JSON.stringify(error.diagnostic);
        assert.ok(!diagnostic.includes("PRIVATE"));
        assert.ok(!diagnostic.includes("私人"));
        return true;
      },
    );
  }
  assert.throws(
    () => validateProduct(null as any),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.deepEqual(error.diagnostic?.reasons, ["invalid_product"]);
      return true;
    },
  );
});

test("empty real photos and optional product facts pass validation", () => {
  const product = newProduct("NO-PHOTO", "无实拍图产品", "") as Product;
  assert.equal(product.photo, "");
  assert.deepEqual(product.photos, []);
  assert.doesNotThrow(() => validateProduct(product));
  product.promptRequirements = "要".repeat(100000);
  assert.doesNotThrow(() => validateProduct(product));
});
