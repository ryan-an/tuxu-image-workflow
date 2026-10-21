import test from "node:test";
import assert from "node:assert/strict";
import {
  newProduct,
  addVersion,
  chosen,
  setPrimary,
} from "../../../shared/model.js";
import {
  SheetBridge,
  workflowSnapshot,
  parseSheet,
  detectColumns,
  cellImages,
  preserveSheetRowHeights,
  applyDefaultRowLayout,
  imageCell,
  validateSheetParse,
  completeProductRows,
} from "../../../src/integrations/sheet-bridge.js";
import { fixture, png } from "../../support/production.js";
import { createSheet } from "../../../src/application/sheet.js";
import { editable, differences } from "../../../shared/workspace-edits.js";

test("imported sheet results survive server persistence without replacing generated history", async () => {
  const f = await fixture();
  try {
    const state = await f.workflows.repo.view();
    const changed = structuredClone(state);
    const product = changed.products[0];
    const version = addVersion(product.tasks[0], png, "导入结果", "imported");
    const saved = await f.workflows.edit(
      differences(editable(state), editable(changed)),
    );
    assert.equal(saved.products[0].tasks[0].primaryId, version.id);
    assert.equal(saved.products[0].tasks[0].versions.length, 1);
    assert.match(
      saved.products[0].tasks[0].versions[0].source,
      /^\/api\/assets\//,
    );
    const next = structuredClone(saved);
    next.products.push(newProduct("NEW-RESULT", "新产品") as any);
    addVersion(next.products[1].tasks[0], png, "新产品结果", "imported");
    const created = await f.workflows.edit(
      differences(editable(saved), editable(next)),
    );
    assert.equal(created.products[1].tasks[0].versions.length, 1);
    const tampered = structuredClone(created);
    tampered.products[0].tasks[0].versions[0].prompt = "覆盖历史";
    await assert.rejects(
      f.workflows.edit(differences(editable(created), editable(tampered))),
      /不能覆盖/,
    );
  } finally {
    await f.close();
  }
});

test("sheet drafts remain separate from products and background backfill until explicit parsing", async () => {
  const product = newProduct("DRAFT", "产品");
  product.tasks[0].prompt = "工作区提示词";
  const state: any = {
    products: [product],
    sheetSnapshot: workflowSnapshot({ products: [product] }),
  };
  state.sheetSnapshot.sheets.preview.cellData[2][4] = { v: "未同步草稿" };
  state.sheetSnapshot.sheets.preview.rowData[2].custom = {
    workflowDirty: true,
  };
  const bridge = new SheetBridge(
    state,
    () => {},
    () => {},
  );
  await bridge.sync(product, product.tasks[0], "prompt");
  assert.equal(product.tasks[0].prompt, "工作区提示词");
  assert.equal(bridge.capture().sheets.preview.cellData[2][4].v, "未同步草稿");
  assert.equal(bridge.capture().sheets.preview.cellData[1][1].v, "未同步");
  const h = parserHarness([product], state.sheetSnapshot);
  await h.open();
  assert.equal(
    product.tasks[0].prompt,
    "工作区提示词",
    "opening preview must not update workspace products",
  );
  await h.sheet.confirmParse();
  assert.equal(product.tasks[0].prompt, "未同步草稿");
  assert.equal(h.bridge.capture().sheets.preview.cellData[1][1].v, "已同步");
});

function parserHarness(
  products: any[],
  snapshot = workflowSnapshot({ products }),
  sourceId = "preview",
) {
  const state: any = { products, sheetSnapshot: snapshot };
  const bridge = new SheetBridge(
    state,
    () => {},
    () => {},
  );
  const saved: any[] = [];
  let closed = false;
  const context: any = {
    state,
    bridge,
    ui: {},
    notify() {},
    change() {},
    publish() {},
    showModal() {},
    closeModal() {
      closed = true;
    },
    switchView: async () => {},
    persist: async () => {
      saved.push(structuredClone(state));
    },
  };
  const sheet = createSheet(context);
  Object.assign(context, sheet, { switchView: async () => {} });
  return {
    state,
    bridge,
    sheet,
    context,
    saved,
    closed: () => closed,
    async open() {
      bridge.workbook = {
        save: () => structuredClone(state.sheetSnapshot),
        getActiveSheet: () => ({ getSheetId: () => sourceId }),
      } as any;
      await sheet.openParser();
      bridge.workbook = null;
    },
  };
}

test("parsing a reference-only product inserts missing rows without erasing saved outputs or following products", async () => {
  const first = newProduct("ONLY-REFERENCE", "首产品", "资料"),
    second = newProduct("FOLLOWING", "后产品", "后资料");
  first.tasks[0].references = [png];
  first.tasks[0].prompt = "工作区已有提示词";
  addVersion(first.tasks[0], png, first.tasks[0].prompt);
  second.tasks[0].prompt = "后产品提示词";
  const snapshot = workflowSnapshot({ products: [first, second] }),
    preview = snapshot.sheets.preview;
  const old = structuredClone(preview);
  preview.cellData = {
    0: old.cellData[0],
    1: old.cellData[1],
    2: old.cellData[4],
    3: old.cellData[5],
    4: old.cellData[6],
  };
  preview.cellData[2][22] = { v: "自定义列必须保留" };
  preview.rowData = {
    0: old.rowData[0],
    1: old.rowData[1],
    2: old.rowData[4],
    3: {
      ...old.rowData[5],
      h: 188,
      custom: {
        workflowDraftVersion: 1,
        workflowDirty: true,
        workflowDrafts: {
          5: {
            base: { text: "", images: [], formula: "" },
            value: { text: "后产品草稿", images: [], formula: "" },
          },
        },
      },
    },
    4: old.rowData[6],
  };
  preview.mergeData = [0, 1, 2].map((column) => ({
    startRow: 2,
    endRow: 4,
    startColumn: column,
    endColumn: column,
  }));
  const completed = completeProductRows(snapshot, [first.code]);
  assert.equal(
    completed.snapshot.sheets.preview.cellData[4][22].v,
    "自定义列必须保留",
  );
  assert.equal(completed.snapshot.sheets.preview.rowData[5].h, 188);
  assert.equal(
    completed.snapshot.sheets.preview.rowData[5].custom.workflowDrafts[5].value
      .text,
    "后产品草稿",
  );
  assert.equal(
    completeProductRows(completed.snapshot, [first.code]).changed,
    false,
    "repeated normalization must be idempotent",
  );
  const h = parserHarness([first, second], snapshot);
  await h.open();
  await h.sheet.confirmParse();
  const saved = h.state.sheetSnapshot.sheets.preview;
  assert.deepEqual(
    [1, 2, 3].map((row) => saved.cellData[row][3].v),
    ["示例图", "提示词", "结果图"],
  );
  assert.equal(saved.cellData[2][4].v, "工作区已有提示词");
  assert.equal(cellImages(saved.cellData[3][4])[0], png);
  assert.equal(saved.cellData[4][0].v, second.code);
  assert.equal(saved.cellData[4][22].v, "自定义列必须保留");
  assert.equal(saved.cellData[5][4].v, "后产品提示词");
  for (const row of [1, 4])
    for (const column of [0, 1, 2])
      assert.ok(
        saved.mergeData.some(
          (m: {
            startRow: number;
            endRow: number;
            startColumn: number;
            endColumn: number;
          }) =>
            m.startRow === row &&
            m.endRow === row + 2 &&
            m.startColumn === column &&
            m.endColumn === column,
        ),
      );
});

test("parsing fills only the missing prompt row, preserves imported results and merges existing unmerged blocks", async () => {
  const product = newProduct("MISSING-PROMPT", "产品", "资料");
  product.tasks[0].prompt = "已有提示词";
  addVersion(product.tasks[0], png, "已有提示词");
  const snapshot = workflowSnapshot({ products: [product] }),
    preview = snapshot.sheets.preview;
  preview.cellData[2] = preview.cellData[3];
  preview.rowData[2] = preview.rowData[3];
  delete preview.cellData[3];
  delete preview.rowData[3];
  preview.mergeData = [];
  const h = parserHarness([product], snapshot);
  await h.open();
  await h.sheet.confirmParse();
  const saved = h.state.sheetSnapshot.sheets.preview;
  assert.equal(saved.cellData[2][3].v, "提示词");
  assert.equal(saved.cellData[2][4].v, "已有提示词");
  assert.equal(cellImages(saved.cellData[3][4])[0], png);
  assert.equal(product.tasks[0].versions.length, 1);
  saved.mergeData = [];
  await h.open();
  await h.sheet.confirmParse();
  assert.equal(h.state.sheetSnapshot.sheets.preview.mergeData.length, 3);
  assert.deepEqual(Object.keys(h.state.sheetSnapshot.sheets.preview.cellData), [
    "0",
    "1",
    "2",
    "3",
  ]);
});

test("new preview products get all three rows and conflicting metadata cannot be silently merged away", async () => {
  const incoming = newProduct("NEW-ROWS", "新产品", "资料");
  incoming.tasks[0].references = [png];
  const snapshot = workflowSnapshot({ products: [incoming] });
  delete snapshot.sheets.preview.cellData[2];
  delete snapshot.sheets.preview.cellData[3];
  snapshot.sheets.preview.mergeData = [];
  const h = parserHarness([], snapshot);
  await h.open();
  await h.sheet.confirmParse();
  h.bridge.setProducts(h.state.products);
  assert.equal(h.state.products.length, 1);
  assert.equal(h.state.sheetSnapshot.sheets.preview.cellData[2][3].v, "提示词");
  assert.equal(h.state.sheetSnapshot.sheets.preview.cellData[3][3].v, "结果图");
  assert.equal(h.state.sheetSnapshot.sheets.preview.cellData[1][1].v, "已同步");
  const saved = h.state.sheetSnapshot.sheets.preview;
  saved.mergeData = [];
  saved.cellData[2][2] = { v: "另一份未合并资料" };
  await h.open();
  const before = structuredClone(h.state.sheetSnapshot);
  await assert.rejects(h.sheet.confirmParse(), /合并前请先整理/);
  assert.deepEqual(h.state.sheetSnapshot, before);
});

test("preview parsing applies clears, selects an existing result, and preserves history and unmapped fields", async () => {
  const product: any = newProduct("ACCURATE", "产品", "旧资料");
  product.photo = png;
  product.photos = [png];
  product.tasks[0].references = [png];
  product.tasks[0].prompt = "旧提示词";
  const old = addVersion(product.tasks[0], png, "old");
  const recent = addVersion(
    product.tasks[0],
    png.replace("image/png", "image/x-png"),
    "recent",
  );
  setPrimary(product.tasks[0], recent.id);
  product.tasks[1].references = [png, "second-reference"];
  addVersion(product.tasks[1], png, "history");
  product.tasks[2].prompt = "未映射字段保留";
  const snapshot = workflowSnapshot({ products: [product] });
  const cells = snapshot.sheets.preview.cellData;
  cells[1][2] = { v: "产品" };
  cells[1][14] = { v: "" };
  cells[1][4] = { v: "" };
  cells[2][4] = { v: "" };
  cells[3][4] = imageCell(png);
  cells[3][5] = { v: "" };
  const h = parserHarness([product], snapshot);
  await h.open();
  h.sheet.updateParser(undefined, 2, -1);
  assert.deepEqual(h.context.ui.parser.issues, []);
  await h.sheet.confirmParse();
  assert.equal(product.facts, "");
  assert.equal(product.photo, "");
  assert.deepEqual(product.photos, []);
  assert.deepEqual(product.tasks[0].references, []);
  assert.equal(product.tasks[0].prompt, "");
  assert.equal(product.tasks[0].promptHistory[0].prompt, "旧提示词");
  assert.equal(chosen(product.tasks[0])?.id, old.id);
  assert.equal(product.tasks[0].versions.length, 2);
  assert.deepEqual(product.tasks[1].references, [png, "second-reference"]);
  assert.equal(chosen(product.tasks[1]), undefined);
  assert.equal(product.tasks[1].versions.length, 1);
  assert.equal(product.tasks[2].prompt, "未映射字段保留");
  assert.equal(
    h.saved.length,
    2,
    "save both the source sheet and parsed products",
  );
  assert.equal(h.saved[1].products[0].tasks[0].prompt, "");
  assert.equal(h.closed(), true);
});

test("single-row external imports preserve omitted fields and map text and images by role", async () => {
  const product = newProduct("EXTERNAL", "已有产品", "已有资料");
  product.tasks[0].references = [png];
  product.tasks[0].prompt = "已有提示词";
  const snapshot = workflowSnapshot({ products: [product] });
  snapshot.sheets.inbox.cellData = {
    0: {
      0: { v: "产品编号" },
      1: { v: "产品名称 / 资料" },
      2: { v: "尺寸图" },
      3: { v: "卖点图" },
    },
    1: { 0: { v: "EXTERNAL" }, 1: { v: "" }, 2: { v: "" }, 3: imageCell(png) },
    2: {
      0: { v: "NEW" },
      1: { v: "新产品\r\n尺寸资料" },
      2: { v: "多行\n提示词" },
    },
  } as any;
  const h = parserHarness([product], snapshot, "inbox");
  await h.open();
  assert.equal(h.context.ui.parser.candidates.length, 2);
  assert.deepEqual(h.context.ui.parser.issues, []);
  await h.sheet.confirmParse();
  assert.equal(product.name, "已有产品");
  assert.equal(product.tasks[0].prompt, "已有提示词");
  assert.deepEqual(product.tasks[0].references, [png]);
  assert.deepEqual(product.tasks[1].references, [png]);
  assert.equal(h.state.products[1].facts, "尺寸资料");
  assert.equal(h.state.products[1].tasks[0].prompt, "多行\n提示词");
});

test("duplicate product blocks and overlapping mappings cannot silently overwrite products", async () => {
  const product = newProduct("DUP", "原产品");
  const duplicate = newProduct("DUP", "复制产品");
  const h = parserHarness(
    [product],
    workflowSnapshot({ products: [product, duplicate] }),
  );
  await h.open();
  assert.match(h.context.ui.parser.issues.join(""), /编号.*重复/);
  await assert.rejects(h.sheet.confirmParse(), /重复/);
  assert.equal(product.name, "原产品");
  const source = h.context.ui.parser.source;
  const mapping = { ...detectColumns(source), nameColumn: 0 };
  assert.match(
    validateSheetParse(
      source,
      mapping,
      "auto",
      parseSheet(source, mapping),
    ).join(""),
    /同一列/,
  );
});

test("a failed final save keeps the parser open for retry", async () => {
  const product = newProduct("SAVE");
  const h = parserHarness([product]);
  await h.open();
  h.context.persist = async () => {
    throw new Error("保存失败");
  };
  await assert.rejects(h.sheet.confirmParse(), /保存失败/);
  assert.equal(h.closed(), false);
  assert.equal(h.bridge.capture().sheets.preview.cellData[1][1].v, "未同步");
  h.context.persist = async () => {};
  await h.sheet.confirmParse();
  assert.equal(h.closed(), true);
});

test("pasting below a product page appends draft rows without replacing hidden products", () => {
  const products = [newProduct("FIRST"), newProduct("HIDDEN")];
  const state: any = {
    products,
    sheetSnapshot: workflowSnapshot({ products }),
  };
  const bridge = new SheetBridge(
    state,
    () => {},
    () => {},
  );
  bridge.setProducts([products[0]]);
  const local = bridge.project();
  bridge.workbook = {
    getSheetBySheetId: () => ({ setRowHeight() {} }),
  } as any;
  const firstNew = bridge.ensurePageRow(4);
  assert.equal(firstNew, 7);
  assert.equal(bridge.ensurePageRow(6), 9);
  assert.equal(bridge.canonicalRow(5, "preview"), 8);
  assert.equal(state.sheetSnapshot.sheets.preview.cellData[4][0].v, "HIDDEN");
  const sheet = state.sheetSnapshot.sheets.preview;
  for (let offset = 0; offset < 3; offset++) {
    sheet.cellData[firstNew + offset] = structuredClone(
      local.sheets.preview.cellData[1 + offset],
    );
  }
  sheet.cellData[firstNew][0].v = "DRAFT";
  sheet.mergeData.push(
    ...[0, 1, 2].map((column) => ({
      startRow: 7,
      endRow: 9,
      startColumn: column,
      endColumn: column,
    })),
  );
  assert.deepEqual(
    [7, 8, 9].map((row) => sheet.rowData[row].h),
    [160, 120, 160],
  );
  bridge.workbook = null;
  bridge.setProducts([products[1]]);
  const nextPage = bridge.project().sheets.preview;
  assert.deepEqual(
    parseSheet(nextPage, detectColumns(nextPage)).map(
      (product) => product.code,
    ),
    ["HIDDEN", "DRAFT"],
  );
});

test("product status follows successful parsing and later table edits", async () => {
  const product = newProduct("STATUS", "状态产品", "尺寸资料");
  product.tasks[0].prompt = "已解析的提示词";
  const state: any = {
    products: [],
    sheetSnapshot: workflowSnapshot({ products: [product] }),
  };
  const bridge = new SheetBridge(
    state,
    () => {},
    () => {},
  );
  const column = detectColumns(state.sheetSnapshot.sheets.preview).statusColumn;
  const status = () => bridge.capture().sheets.preview.cellData[1][column].v;
  assert.equal(status(), "新建产品");
  const context: any = {
    state,
    bridge,
    ui: {},
    notify() {},
    change() {},
    closeModal() {},
    publish() {},
    showModal() {},
    switchView: async () => {},
    persist: async () => {},
  };
  const sheet = createSheet(context);
  Object.assign(context, sheet, { switchView: async () => {} });
  bridge.workbook = {
    save: () => structuredClone(state.sheetSnapshot),
    getActiveSheet: () => ({ getSheetId: () => "preview" }),
  } as any;
  await sheet.openParser();
  bridge.workbook = null;
  await sheet.confirmParse();
  bridge.setProducts(state.products);
  assert.equal(state.products.length, 1);
  assert.equal(status(), "已同步");
  assert.deepEqual(
    Object.keys(state.sheetSnapshot.sheets.preview.cellData),
    ["0", "1", "2", "3"],
    "parsing a new product from preview must not append a duplicate block",
  );
  const roleColumn = detectColumns(state.sheetSnapshot.sheets.preview).roles[0];
  bridge.writeCell(2, roleColumn, { v: "表格修改后的提示词" });
  assert.equal(status(), "未同步");
  state.products[0].tasks[0].prompt = "表格修改后的提示词";
  assert.equal(status(), "已同步");
  const restored = new SheetBridge(
    JSON.parse(JSON.stringify(state)),
    () => {},
    () => {},
  );
  assert.equal(
    restored.capture().sheets.preview.cellData[1][column].v,
    "已同步",
  );
  const second = newProduct("SECOND");
  state.products.push(second);
  bridge.appendProduct(second);
  assert.equal(
    bridge.capture().sheets.preview.cellData[4][column].v,
    "新建产品",
  );
  assert.ok(
    state.sheetSnapshot.sheets.preview.mergeData.some(
      (range: { startRow: number; endRow: number; startColumn: number }) =>
        range.startRow === 4 &&
        range.endRow === 6 &&
        range.startColumn === column,
    ),
  );
});

test("sheet rows keep their configured height when long prompts are restored", () => {
  const product = newProduct("HEIGHT");
  product.tasks[0].prompt = "长提示词\n".repeat(500);
  const snapshot = workflowSnapshot({ products: [product] });
  const preview = snapshot.sheets.preview;
  assert.deepEqual(
    [1, 2, 3].map((row) => preview.rowData[row].h),
    [160, 120, 160],
  );
  assert.equal(preview.rowData[2].ia, 0);
  assert.equal(snapshot.sheets.inbox.rowData[499].ia, 0);

  // Old saved sheets may contain an oversized computed height or custom heights.
  preview.rowData[2] = { h: 94, ah: 9000, ia: 1 };
  preview.rowData[3] = { h: 180 };
  delete preview.rowData[10];
  delete preview.rowData[0].custom;
  applyDefaultRowLayout(snapshot);
  preserveSheetRowHeights(snapshot);
  assert.deepEqual(preview.rowData[2], { h: 120, ia: 0 });
  assert.deepEqual(preview.rowData[3], { h: 180, ia: 0 });
  assert.deepEqual(preview.rowData[10], { h: 36, ia: 0 });
  assert.equal(preview.cellData[2][4].v, product.tasks[0].prompt);
  preview.rowData[2].h = 144;
  applyDefaultRowLayout(snapshot);
  assert.equal(
    preview.rowData[2].h,
    144,
    "custom row heights survive reloading",
  );
});

test("bulk sheet sync captures once at each boundary and preserves merged product bindings", async () => {
  const state: any = {
    products: Array.from({ length: 20 }, (_, index) =>
      newProduct(`SHEET-${index}`, `产品 ${index}`, "尺寸资料"),
    ),
  };
  state.sheetSnapshot = workflowSnapshot(state);
  const snapshot = structuredClone(state.sheetSnapshot);
  let saves = 0,
    writes = 0;
  const bridge = new SheetBridge(
    state,
    () => {},
    () => {},
  );
  bridge.workbook = {
    save: () => {
      saves++;
      return structuredClone(snapshot);
    },
    getSheetBySheetId: (id: string) => ({
      getRange: () => ({
        setValues: (cells: any) => {
          writes++;
          for (const [row, columns] of Object.entries(cells))
            Object.assign((snapshot.sheets[id].cellData[row] ||= {}), columns);
        },
      }),
    }),
  } as any;
  for (const product of state.products)
    for (const task of product.tasks) {
      task.prompt = `${product.code} ${task.role} 手动提示词`;
      task.references = [png];
    }
  assert.deepEqual(await bridge.reconcile(), []);
  assert.equal(saves, 2);
  assert.equal(writes, 1);
  const parsed = parseSheet(
    state.sheetSnapshot.sheets.preview,
    detectColumns(state.sheetSnapshot.sheets.preview),
  );
  assert.equal(parsed.length, 20);
  assert.equal(parsed[19].facts, "尺寸资料");
  assert.equal(parsed[19].tasks[9].prompt, "SHEET-19 A+ 4 手动提示词");
  assert.equal(parsed[19].tasks[9].references[0], png);
  saves = 0;
  writes = 0;
  assert.deepEqual(await bridge.reconcile(), []);
  assert.equal(
    writes,
    0,
    "unchanged cells should not trigger a spreadsheet mutation",
  );
  assert.equal(saves, 2);
});

test("batch cleanup after failed work still allows later sheet edits", async () => {
  const product = newProduct("RECOVER");
  const state: any = { products: [product] };
  state.sheetSnapshot = workflowSnapshot(state);
  const bridge = new SheetBridge(
    state,
    () => {},
    () => {},
  );
  await assert.rejects(
    bridge.batch(async () => {
      product.tasks[0].references = [png];
      await bridge.sync(product, product.tasks[0], "reference");
      throw new Error("stopped");
    }),
    /stopped/,
  );
  product.tasks[0].prompt = "后续编辑";
  await bridge.sync(product, product.tasks[0], "prompt");
  assert.equal(state.sheetSnapshot.sheets.preview.cellData[2][4].v, "后续编辑");
  assert.equal(
    cellImages(state.sheetSnapshot.sheets.preview.cellData[1][4])[0],
    png,
  );
});

test("repeated inline image bytes are persisted once per request while validation remains active", async (t) => {
  const f = await fixture();
  try {
    const assets = f.workflows.assets;
    const put = t.mock.method(assets, "put");
    const normalized = await assets.normalize({
      photo: png,
      references: Array(30).fill(png),
      sheet: { source: png },
    });
    assert.equal(put.mock.callCount(), 1);
    assert.ok(
      normalized.references.every(
        (source: string) => source === normalized.photo,
      ),
    );
    assert.equal(normalized.sheet.source, normalized.photo);
    assert.equal(
      (await assets.get(normalized.photo.split("/").at(-1))).mime,
      "image/png",
    );
    await assert.rejects(
      assets.normalize("data:image/png;base64,YmFk"),
      /图片格式无效/,
    );
  } finally {
    await f.close();
  }
});
