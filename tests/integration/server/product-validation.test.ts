import test from "node:test";
import assert from "node:assert/strict";
import { newProduct, ROLES } from "../../../shared/model.js";
import {
  detectColumns,
  parseSheet,
  validateSheetParse,
} from "../../../shared/sheet-data.js";
import { WorkspaceClient } from "../../../src/services/workspace-client.js";
import { differences, editable } from "../../../shared/workspace-edits.js";
import { fixture, loginHeaders } from "../../support/production.js";

test("sheet parsing preserves multiline and tabbed product codes and permits empty real-photo cells", () => {
  const header = ["产品编号", "产品名称 / 规格", ...ROLES, "实拍图1"];
  const sheet: any = {
    id: "inbox",
    name: "外部粘贴",
    rowCount: 10,
    columnCount: 20,
    cellData: {
      0: Object.fromEntries(header.map((v, index) => [index, { v }])),
      1: { 0: { v: "SKU-01" }, 1: { v: "产品名称" } },
    },
  };
  const mapping = detectColumns(sheet);
  const parsed = parseSheet(sheet, mapping);
  assert.deepEqual(parsed[0].photos, []);
  assert.deepEqual(validateSheetParse(sheet, mapping, "auto", parsed), []);
  for (const code of ["SKU\n01", "SKU\r\n01", "SKU\t01"]) {
    sheet.cellData[1][0].v = code;
    const candidates = parseSheet(sheet, mapping);
    const issues = validateSheetParse(sheet, mapping, "auto", candidates);
    assert.deepEqual(issues, []);
    assert.equal(candidates[0].code, code.replace(/\r\n/g, "\n"));
    assert.deepEqual(candidates[0].photos, []);
  }
});

test("save errors identify the product and field, log safe reasons and keep the transaction unchanged", async (t) => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const warnings: any[] = [];
    t.mock.method(f.app.log, "warn", (...args: any[]) => warnings.push(args));
    for (const [field, value, message, reason] of [
      ["name", "   ", "产品名称不能为空", "empty_name"],
      ["code", "  ", "产品编号不能为空", "empty_code"],
      [
        "promptRequirements",
        " ",
        "本产品生成要求不能为空",
        "empty_requirements",
      ],
    ]) {
      const edits = [
        {
          path: ["products", f.product.id, "facts"],
          before: f.product.facts,
          value: "尚未保存的私人资料",
        },
        {
          path: ["products", f.product.id, field],
          before: (f.product as any)[field],
          value,
        },
      ];
      // Retrying the same rejected draft must remain a client error, with the
      // original product intact and an actionable field in the response.
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await f.app.inject({
          method: "PATCH",
          url: "/api/workspace",
          headers,
          payload: { edits },
        });
        assert.equal(response.statusCode, 400, response.body);
        assert.ok(response.json().error.includes(message), response.body);
        if (field !== "code") assert.match(response.json().error, /产品「/);
        assert.deepEqual(
          (await f.workflows.repo.view()).products[0],
          f.product,
        );
        const [diagnostic, logMessage] = warnings.at(-1);
        assert.equal(logMessage, "product validation failed");
        assert.equal(diagnostic.productId, f.product.id);
        assert.equal(diagnostic.requestId, response.json().requestId);
        assert.deepEqual(diagnostic.reasons, [reason]);
        assert.ok(!JSON.stringify(diagnostic).includes("PRIVATE"));
        assert.ok(!JSON.stringify(diagnostic).includes("私人"));
      }
    }
  } finally {
    await f.close();
  }
});

test("the frontend save client creates and edits products with no real photos through the actual save API", async (t) => {
  const f = await fixture();
  try {
    const state = await f.workflows.repo.view();
    const headers = await loginHeaders(f.app);
    t.mock.method(globalThis, "fetch", async (url: any, options: any) => {
      assert.equal(url, "/api/workspace");
      assert.equal(options.method, "PATCH");
      const response = await f.app.inject({
        method: options.method,
        url,
        headers: { ...options.headers, ...headers },
        payload: options.body,
      });
      return new Response(response.body, { status: response.statusCode });
    });
    const client = new WorkspaceClient(state, {
      render() {},
      sync() {},
      notify() {},
    });
    state.products[0].photo = "";
    state.products[0].photos = [];
    state.products[0].facts = "移除全部实拍图后保存";
    const product = newProduct("NO-PHOTO\n01\t套装", "仅参考图产品", "") as any;
    product.tasks[0].references = [f.product.photo];
    state.products.push(product);
    await client.save();
    assert.deepEqual(
      differences(editable(client.baseline), editable(state)),
      [],
    );
    // Exercise a later autosave too, when an empty photo list is already the
    // saved baseline, rather than only clearing previously uploaded photos.
    state.products.find((p: any) => p.id === product.id)!.name =
      "空实拍图仍可编辑";
    state.products.find((p: any) => p.id === f.product.id)!.code =
      "EXISTING\r\n02\t套装";
    await client.save();
    await f.reopen();
    const saved = await f.workflows.repo.view();
    assert.equal(saved.products.length, 2);
    for (const item of saved.products) {
      assert.equal(item.photo, "");
      assert.deepEqual(item.photos, []);
    }
    const created = saved.products.find((p) => p.id === product.id)!;
    assert.equal(created.code, product.code);
    assert.equal(
      saved.products.find((p) => p.id === f.product.id)!.code,
      "EXISTING\r\n02\t套装",
    );
    assert.equal(created.name, "空实拍图仍可编辑");
    assert.equal(created.facts, "");
    assert.deepEqual(created.tasks[0].references, [f.product.photo]);
  } finally {
    await f.close();
  }
});
