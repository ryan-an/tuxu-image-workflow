import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { newProduct, ROLES } from "../../../shared/model.js";
import {
  SheetBridge,
  workflowSnapshot,
  detectColumns,
  parseSheet,
  validateSheetParse,
  imageCell,
  cellImages,
  cellText,
  ensureTrailingPhotos,
} from "../../../src/integrations/sheet-bridge.js";
import { createSheet } from "../../../src/application/sheet.js";
import { fixture } from "../../support/production.js";
import { editable, differences } from "../../../shared/workspace-edits.js";

function external(sources: string[]) {
  const header = [
    "序列",
    "编号",
    "产品信息",
    ...ROLES.map((role, i) => `${i + 2}${role.replace(/A\+ (\d)/, "A+($1)")}`),
    ...sources.map((_, i) => `实拍图${i + 1}`),
  ];
  const cells: any = {
    0: Object.fromEntries(header.map((v, c) => [c, { v }])),
    1: {
      0: { v: "第一套" },
      1: { v: "PHOTO-01" },
      2: { v: "产品名称\n产品资料" },
    },
  };
  for (let i = 0; i < ROLES.length; i++)
    cells[1][i + 3] = imageCell("/api/assets/" + "f".repeat(64));
  sources.forEach(
    (source, i) => (cells[1][3 + ROLES.length + i] = imageCell(source)),
  );
  return {
    id: "inbox",
    name: "外部粘贴",
    rowCount: 500,
    columnCount: 50,
    cellData: cells,
  };
}

test("screenshot-style headers collect 6, 8 and 12 trailing photos in order without swallowing reference columns", () => {
  for (const count of [6, 8, 12]) {
    const photos = Array.from(
      { length: count },
      (_, i) => "/api/assets/" + String(i + 1).padStart(64, "0"),
    );
    const sheet = external(photos);
    const mapping = detectColumns(sheet);
    assert.equal(mapping.codeColumn, 1);
    assert.equal(mapping.photoColumns.length, count);
    assert.ok(mapping.roles.every((c: number) => c >= 0));
    const [parsed] = parseSheet(sheet, mapping);
    assert.equal(parsed.code, "PHOTO-01");
    assert.deepEqual(parsed.photos, photos);
    assert.equal(parsed.photo, photos[0]);
    assert.equal(
      parsed.tasks[0].references[0],
      "/api/assets/" + "f".repeat(64),
    );
    assert.deepEqual(validateSheetParse(sheet, mapping, "auto", [parsed]), []);
  }
});

test("photo collection skips gaps, deduplicates and includes unlabelled trailing image cells", () => {
  const sheet = external(["one", "", "two", "one"]);
  sheet.cellData[0][16].v = "实拍图56";
  sheet.cellData[0][17] = { v: "" };
  sheet.cellData[1][17] = imageCell("three");
  const [parsed] = parseSheet(sheet, detectColumns(sheet));
  assert.deepEqual(parsed.photos, ["one", "two", "three"]);
});

test("new and legacy workbooks put all real photos last, preserve reference cells, dirty prompts, merges and custom heights", () => {
  const product: any = newProduct("PHOTO-01", "产品");
  product.photo = "one";
  product.photos = [
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
  ];
  product.tasks[0].references = ["reference"];
  const fresh = workflowSnapshot({ products: [product] });
  let mapping = detectColumns(fresh.sheets.preview);
  assert.equal(mapping.roles[0], 4);
  assert.equal(mapping.photoColumns.length, 9);
  assert.ok(mapping.photoColumns[0] > Math.max(...mapping.roles));
  assert.deepEqual(
    parseSheet(fresh.sheets.preview, mapping)[0].photos,
    product.photos,
  );
  // Reconstruct the old layout with a single leading photo column.
  const old = structuredClone(fresh);
  const sheet = old.sheets.preview;
  for (const row of Object.keys(sheet.cellData)) {
    const cells = sheet.cellData[row];
    const next: any = {};
    for (const [key, value] of Object.entries(cells)) {
      const c = Number(key);
      if (mapping.photoColumns.includes(c)) continue;
      next[c >= 4 ? c + 1 : c] = value;
    }
    next[4] =
      row === "0"
        ? { v: "实拍图" }
        : row === "1"
          ? imageCell("one")
          : { v: "" };
    sheet.cellData[row] = next;
  }
  sheet.cellData[2][5] = { v: "未解析草稿" };
  sheet.rowData[2].custom.workflowDirty = true;
  sheet.rowData[2].h = 177;
  assert.equal(ensureTrailingPhotos(old, [product]), true);
  mapping = detectColumns(sheet);
  assert.equal(cellText(sheet.cellData[2][mapping.roles[0]]), "未解析草稿");
  assert.equal(sheet.rowData[2].h, 177);
  assert.equal(cellImages(sheet.cellData[1][mapping.roles[0]])[0], "reference");
  assert.deepEqual(parseSheet(sheet, mapping)[0].photos, product.photos);
  assert.equal(ensureTrailingPhotos(old, [product]), false);
  const bridge = new SheetBridge(
    { products: [product], sheetSnapshot: old },
    () => {},
    () => {},
  );
  bridge.setProducts([product]);
  const page = bridge.project();
  assert.equal(
    parseSheet(page.sheets.preview, detectColumns(page.sheets.preview))[0]
      .photos.length,
    9,
  );
});

test("saving an external row persists every photo into the existing real-photo list and retains them after reload", async () => {
  const f = await fixture();
  try {
    const photos = [];
    for (let i = 0; i < 9; i++) {
      const bytes = await sharp({
        create: {
          width: 2,
          height: 2,
          channels: 3,
          background: { r: i * 20, g: 20, b: 30 },
        },
      })
        .png()
        .toBuffer();
      photos.push(await f.workflows.assets.put(bytes, "image/png"));
    }
    const state: any = await f.workflows.repo.view();
    const snapshot = workflowSnapshot(state);
    const source = external(photos);
    source.cellData[1][1] = { v: state.products[0].code };
    for (let i = 0; i < ROLES.length; i++)
      source.cellData[1][i + 3] = imageCell(photos[0]);
    snapshot.sheets.inbox = source;
    state.sheetSnapshot = snapshot;
    const bridge = new SheetBridge(
      state,
      () => {},
      () => {},
    );
    let baseline = editable(await f.workflows.repo.view());
    const context: any = {
      state,
      bridge,
      ui: {},
      notify() {},
      render() {},
      change() {},
      publish() {},
      showModal() {},
      closeModal() {},
      switchView: async () => {},
      persist: async () => {
        await f.workflows.edit(differences(baseline, editable(state)));
        baseline = structuredClone(editable(state));
      },
    };
    const app = createSheet(context);
    Object.assign(context, app, { switchView: async () => {} });
    bridge.workbook = {
      save: () => structuredClone(state.sheetSnapshot),
      getActiveSheet: () => ({ getSheetId: () => "inbox" }),
    } as any;
    await app.openParser();
    bridge.workbook = null;
    await app.confirmParse();
    const saved = (await f.workflows.repo.view()).products[0];
    assert.deepEqual(saved.photos, photos);
    assert.equal(saved.photo, photos[0]);
    assert.equal(saved.tasks[0].references[0], photos[0]);
  } finally {
    await f.close();
  }
});
