import test from "node:test";
import assert from "node:assert/strict";
import { newProduct, addVersion, setPrimary } from "../../../shared/model.js";
import {
  SheetBridge,
  workflowSnapshot,
  detectColumns,
  cellText,
  cellImages,
  imageCell,
  parseSheet,
} from "../../../src/integrations/sheet-bridge.js";
function harness() {
  const product: any = newProduct("CELL-01", "测试产品", "资料");
  product.tasks[0].prompt = "原始提示词";
  product.tasks[1].prompt = "另一位置原始提示词";
  const state: any = {
    products: [product],
    jobs: [],
    sheetSnapshot: workflowSnapshot({ products: [product] }),
  };
  const notices: string[] = [];
  let conflicts: any[] = [];
  const bridge = new SheetBridge(
    state,
    () => {},
    (message: string) => notices.push(message),
    (items: { key: string; message: string }[]) => {
      conflicts = items;
    },
  );
  const mapping = detectColumns(state.sheetSnapshot.sheets.preview);
  return {
    product,
    state,
    bridge,
    mapping,
    notices,
    conflicts: () => conflicts,
  };
}
test("only actual content edits create drafts; formatting, repeated paste and editing back do not", () => {
  const h = harness(),
    c = h.mapping.roles[0],
    cell = h.state.sheetSnapshot.sheets.preview.cellData[2][c];
  assert.equal(
    h.bridge.recordCellEdit(2, c, cell, { ...cell, s: "format" }),
    false,
  );
  h.bridge.writeUserCell(2, c, { v: "原始提示词" });
  assert.equal(h.bridge.isProductDirty(h.product), false);
  h.bridge.writeUserCell(2, c, { v: "手动修改" });
  assert.equal(h.bridge.isProductDirty(h.product), true);
  h.bridge.writeUserCell(2, c, { v: "原始提示词" });
  assert.equal(h.bridge.isProductDirty(h.product), false);
  assert.equal(
    h.bridge.recordCellEdit(1, c, imageCell("same"), imageCell("same")),
    false,
  );
  assert.equal(
    h.bridge.recordCellEdit(2, c, { f: "=A1", v: 1 }, { f: "=A1", v: 2 }),
    false,
    "formula recalculation is not a user edit",
  );
});

test("an edited result image protects only that cell and adopting remote uses the latest selected version", async () => {
  const h = harness(),
    c = h.mapping.roles[0];
  h.bridge.writeUserCell(3, c, imageCell("my-image"));
  addVersion(h.product.tasks[0], "first-image", "prompt");
  await h.bridge.sync(h.product, h.product.tasks[0], "result");
  addVersion(h.product.tasks[0], "latest-image", "prompt");
  await h.bridge.sync(h.product, h.product.tasks[0], "result");
  assert.equal(
    cellImages(h.state.sheetSnapshot.sheets.preview.cellData[3][c])[0],
    "my-image",
  );
  assert.equal(h.conflicts().length, 1);
  h.bridge.resolveConflict(h.conflicts()[0].key, "remote");
  assert.equal(
    cellImages(h.state.sheetSnapshot.sheets.preview.cellData[3][c])[0],
    "latest-image",
  );
  assert.equal(h.bridge.isProductDirty(h.product), false);
});
test("one draft protects only that cell while other prompts, results and selected versions backfill", async () => {
  const h = harness(),
    c = h.mapping.roles[0];
  h.bridge.writeUserCell(2, c, { v: "我的草稿" });
  h.product.tasks[0].prompt = "新提示词";
  h.product.tasks[1].prompt = "另一新提示词";
  const first = addVersion(h.product.tasks[0], "image-one", "prompt");
  await h.bridge.batch(async () => {
    await h.bridge.sync(h.product, h.product.tasks[0], "prompt");
    await h.bridge.sync(h.product, h.product.tasks[1], "prompt");
    await h.bridge.sync(h.product, h.product.tasks[0], "result");
  });
  const cells = h.state.sheetSnapshot.sheets.preview.cellData;
  assert.equal(cellText(cells[2][c]), "我的草稿");
  assert.equal(cellText(cells[2][h.mapping.roles[1]]), "另一新提示词");
  assert.equal(cellImages(cells[3][c])[0], "image-one");
  assert.equal(h.conflicts().length, 1);
  assert.match(h.conflicts()[0].message, /E3/);
  addVersion(h.product.tasks[0], "image-two", "prompt");
  await h.bridge.sync(h.product, h.product.tasks[0], "result");
  assert.equal(cellImages(cells[3][c])[0], "image-two");
  setPrimary(h.product.tasks[0], first.id);
  await h.bridge.sync(h.product, h.product.tasks[0], "result");
  assert.equal(cellImages(cells[3][c])[0], "image-one");
  const count = h.notices.length;
  await h.bridge.sync(h.product, h.product.tasks[0], "prompt");
  assert.equal(h.notices.length, count);
  h.bridge.resolveConflict(h.conflicts()[0].key, "remote");
  assert.equal(cellText(cells[2][c]), "新提示词");
  assert.equal(h.conflicts().length, 0);
  assert.equal(h.bridge.isProductDirty(h.product), false);
});
test("keeping local edits acknowledges current remote value, later changes warn, reverting retries pending backfill", async () => {
  const h = harness(),
    c = h.mapping.roles[0];
  h.bridge.writeUserCell(2, c, { v: "本地" });
  h.product.tasks[0].prompt = "远端一";
  await h.bridge.sync(h.product, h.product.tasks[0], "prompt");
  h.bridge.resolveConflict(h.conflicts()[0].key, "local");
  assert.equal(h.conflicts().length, 0);
  assert.equal(h.bridge.isProductDirty(h.product), true);
  await h.bridge.sync(h.product, h.product.tasks[0], "prompt");
  assert.equal(h.conflicts().length, 0);
  h.product.tasks[0].prompt = "远端二";
  await h.bridge.sync(h.product, h.product.tasks[0], "prompt");
  assert.equal(h.conflicts().length, 1);
  h.bridge.writeUserCell(2, c, { v: "远端一" });
  await h.bridge.retryConflicts();
  assert.equal(
    cellText(h.state.sheetSnapshot.sheets.preview.cellData[2][c]),
    "远端二",
  );
  assert.equal(h.conflicts().length, 0);
});
test("legacy duplicate blanks cannot block backfill; genuine legacy drafts survive reload", async () => {
  const h = harness(),
    sheet = h.state.sheetSnapshot.sheets.preview;
  sheet.cellData[4] = { [h.mapping.typeColumn]: { v: "提示词" } };
  sheet.cellData[5] = { [h.mapping.typeColumn]: { v: "结果图" } };
  sheet.rowData[4] = { custom: { workflowDirty: true } };
  sheet.rowData[5] = { custom: { workflowDirty: true } };
  sheet.cellData[2][h.mapping.roles[1]] = { v: "真正的旧草稿" };
  sheet.rowData[2].custom.workflowDirty = true;
  const bridge = new SheetBridge(
    h.state,
    () => {},
    () => {},
  );
  assert.equal(bridge.draftCustom(4).workflowDirty, false);
  assert.equal(bridge.draftCustom(5).workflowDirty, false);
  assert.ok(bridge.draftCustom(2).workflowDrafts[h.mapping.roles[1]]);
  h.product.tasks[0].prompt = "后台完成";
  await bridge.sync(h.product, h.product.tasks[0], "prompt");
  assert.equal(cellText(sheet.cellData[2][h.mapping.roles[0]]), "后台完成");
  assert.equal(cellText(sheet.cellData[2][h.mapping.roles[1]]), "真正的旧草稿");
  assert.equal(parseSheet(sheet, detectColumns(sheet))[0].sourceRows.length, 3);
  const reloaded = new SheetBridge(
    JSON.parse(JSON.stringify(h.state)),
    () => {},
    () => {},
  );
  assert.ok(reloaded.draftCustom(2).workflowDrafts[h.mapping.roles[1]]);
});
test("editing product code preserves other cell backfill and stable page bindings", async () => {
  const h = harness();
  h.bridge.writeUserCell(1, 0, { v: "新编号" });
  h.product.tasks[0].prompt = "完成";
  await h.bridge.sync(h.product, h.product.tasks[0], "prompt");
  assert.equal(
    cellText(
      h.state.sheetSnapshot.sheets.preview.cellData[2][h.mapping.roles[0]],
    ),
    "完成",
  );
  assert.equal(
    cellText(h.state.sheetSnapshot.sheets.preview.cellData[1][0]),
    "新编号",
  );
  h.bridge.setProducts([h.product]);
  assert.equal(h.bridge.project().sheets.preview.cellData[1][0].v, "新编号");
});
test("native mutation hook ignores identical values and tracks exactly changed cells", () => {
  const h = harness(),
    local = h.bridge.project(),
    listeners: any = {};
  h.bridge.api = {
    Event: { BeforeSheetEditStart: "edit", BeforeCommandExecute: "command" },
    addEvent: (name: string, fn: any) => {
      listeners[name] = fn;
      return { dispose() {} };
    },
  } as any;
  h.bridge.workbook = {
    save: () => structuredClone(local),
    getSheetBySheetId: () => ({
      setRowCustom: (rows: any) => {
        for (const [row, custom] of Object.entries(rows))
          local.sheets.preview.rowData[row].custom = custom;
      },
    }),
  } as any;
  h.bridge.installStatusReadOnly();
  const c = h.mapping.roles[0];
  const event = (cell: any) => ({
    id: "sheet.mutation.set-range-values",
    params: { subUnitId: "preview", cellValue: { 2: { [c]: cell } } },
  });
  listeners.command(event({ v: "原始提示词" }));
  assert.equal(h.bridge.draftCustom(2).workflowDirty, undefined);
  listeners.command(event({ v: "实际修改" }));
  assert.deepEqual(Object.keys(h.bridge.draftCustom(2).workflowDrafts), [
    String(c),
  ]);
  local.sheets.preview.cellData[2][c] = { v: "实际修改" };
  listeners.command(event({ v: "原始提示词" }));
  assert.equal(h.bridge.draftCustom(2).workflowDirty, false);
});
