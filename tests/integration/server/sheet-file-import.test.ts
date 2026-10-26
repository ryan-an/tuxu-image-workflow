import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { importSheetFile } from "../../../shared/sheet-file.js";
import { exportSheetTemplate } from "../../../src/integrations/sheet-template.js";
import {
  SheetBridge,
  workflowSnapshot,
  parseSheet,
  detectColumns,
  imageCell,
  productStatusWrites,
} from "../../../src/integrations/sheet-bridge.js";
import { newProduct } from "../../../shared/model.js";
import { png, fixture, loginHeaders } from "../../support/production.js";
import { editable, differences } from "../../../shared/workspace-edits.js";
import { addVersion } from "../../../shared/model.js";
import {
  applySheetImport,
  sheetImportCounts,
} from "../../../shared/sheet-import.js";
import { WorkspaceDirectory } from "../../../server/production/workspace-directory.js";
import { Members } from "../../../server/production/members.js";

test("sheet import counts only actual product changes, once per product", () => {
  const products = [
    newProduct("SAME", "未修改", "资料"),
    newProduct("EDIT", "旧名称", "资料"),
  ];
  const workspace = { products, sheetSnapshot: workflowSnapshot({ products }) };
  const sheet = workflowSnapshot({ products }).sheets.preview;
  const mapping = detectColumns(sheet);
  const unchanged = parseSheet(sheet, mapping);
  assert.equal(
    applySheetImport(workspace, unchanged, { authoritative: true }).updated,
    0,
  );
  sheet.cellData[4][2].v = "新名称\n新资料";
  sheet.cellData[5][4].v = "新提示词";
  const candidates = parseSheet(sheet, mapping);
  const newSheet = workflowSnapshot({
    products: [newProduct("NEW", "新增", "")],
  }).sheets.preview;
  candidates.push(parseSheet(newSheet, detectColumns(newSheet))[0]);
  const result = applySheetImport(workspace, candidates, {
    authoritative: true,
  });
  assert.deepEqual(
    { created: result.created, updated: result.updated },
    { created: 1, updated: 1 },
  );
  assert.deepEqual(result.updatedIds, [products[1].id]);
  assert.deepEqual(sheetImportCounts(products, candidates), {
    created: 1,
    updated: 1,
  });
  const repeated = applySheetImport(result.state, candidates, {
    authoritative: true,
  });
  assert.equal(repeated.created, 0);
  assert.equal(repeated.updated, 0);
});

async function imported(workbook: ExcelJS.Workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  return importSheetFile({
    name: "产品.xlsx",
    size: buffer.byteLength,
    arrayBuffer: async () => buffer,
  });
}
test("one-line XLSX imports embedded reference and variable real photos in their cells and retains legacy three-row files", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportSheetTemplate());
  const sheet = workbook.getWorksheet("产品模板")!;
  sheet.getCell("A2").value = "FILE-01";
  const id = workbook.addImage({ base64: png, extension: "png" });
  for (const col of [4, 14, 15, 21])
    sheet.addImage(id, { tl: { col, row: 1 }, ext: { width: 70, height: 70 } });
  sheet.getCell(1, 22).value = "实拍图8";
  const source = await imported(workbook),
    products = parseSheet(source, detectColumns(source));
  assert.equal(products.length, 1);
  assert.equal(products[0].sourceRows.length, 1);
  assert.equal(products[0].tasks[0].references[0], png);
  assert.equal(
    products[0].photos.length,
    1,
    "same image across photo cells is deduplicated",
  );
  assert.equal(products[0].tasks[0].present.prompt, false);
  assert.equal(products[0].tasks[0].present.result, false);
  sheet.addRow(["", "", "", "提示词", "旧文件的提示词"]);
  sheet.addRow(["", "", "", "结果图"]);
  for (const column of [1, 2, 3]) sheet.mergeCells(2, column, 4, column);
  const legacy = await imported(workbook);
  assert.equal(
    parseSheet(legacy, detectColumns(legacy))[0].tasks[0].prompt,
    "旧文件的提示词",
  );
});

test("unmatched one-line clipboard rows stay new after edits and can be deleted without affecting saved products or other drafts", () => {
  const saved = newProduct("SAVED", "已保存");
  const state: any = {
    products: [saved],
    sheetSnapshot: workflowSnapshot({ products: [saved] }),
  };
  const bridge = new SheetBridge(
    state,
    () => {},
    () => {},
  );
  const sheet = state.sheetSnapshot.sheets.preview;
  sheet.cellData[4] = structuredClone(sheet.cellData[0]);
  sheet.cellData[5] = {
    0: { v: "DRAFT-A" },
    2: { v: "草稿A" },
    4: imageCell(png),
  };
  sheet.cellData[6] = {
    0: { v: "DRAFT-B" },
    2: { v: "草稿B" },
    4: imageCell(png),
  };
  bridge.writeUserCell(5, 2, { v: "草稿A修改" });
  bridge.writeUserCell(6, 2, { v: "草稿B修改" });
  bridge.capture();
  const products = parseSheet(sheet, detectColumns(sheet));
  assert.deepEqual(
    products.map((p) => p.code),
    ["SAVED", "DRAFT-A", "DRAFT-B"],
  );
  for (const row of [5, 6]) assert.equal(sheet.cellData[row][1].v, "新建产品");
  bridge.removeDraftRows([5]);
  assert.equal(state.products.length, 1);
  assert.equal(sheet.cellData[5], undefined);
  assert.equal(sheet.cellData[6][2].v, "草稿B修改");
  assert.throws(() => bridge.removeDraftRows([1]), /已在工作区/);
  assert.throws(() => bridge.removeDraftRows([0]), /表头/);
  sheet.cellData[6][0].v = "SAVED";
  assert.ok(
    productStatusWrites(state.sheetSnapshot, [saved]).some(
      (write) => write.cell.v === "未同步",
    ),
  );
});

test("file import rejects unsupported, corrupt and proprietary image-formula files explicitly", async () => {
  await assert.rejects(importSheetFile({ name: "bad.xls" }), /XLSX/);
  await assert.rejects(
    importSheetFile({ name: "large.xlsx", size: 51 * 1024 * 1024 }),
    /50MB/,
  );
  await assert.rejects(
    importSheetFile({
      name: "broken.xlsx",
      size: 1,
      arrayBuffer: async () => new Uint8Array([1]),
    }),
    /无法读取/,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportSheetTemplate());
  workbook.worksheets[0].getCell("E2").value = {
    formula: 'DISPIMG("test",1)',
    result: "",
  };
  await assert.rejects(imported(workbook), /专有单元格图片/);
});

async function batchPayload(codes: string[]) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportSheetTemplate());
  const sheet = workbook.worksheets[0];
  sheet.spliceRows(2, 1);
  codes.forEach((code) =>
    sheet.addRow([code, "", `产品${code}\n批量资料`, "示例图"]),
  );
  const id = workbook.addImage({ base64: png, extension: "png" });
  for (const row of [1, codes.length])
    sheet.addImage(id, { tl: { col: 4, row }, ext: { width: 32, height: 32 } });
  const buffer = await workbook.xlsx.writeBuffer();
  return {
    name: "整批产品.xlsx",
    data: Buffer.from(buffer).toString("base64"),
  };
}

test("file imports, deletion and asset cleanup stay in the selected workspace and respect viewer roles", async () => {
  const f = await fixture();
  try {
    const directory = new WorkspaceDirectory(f.db);
    const { id } = await directory.create("owner", "独立导入空间");
    const headers = await loginHeaders(f.app);
    const scoped = { ...headers, "x-workspace-id": id };
    const previewResponse = await f.app.inject({
      method: "POST",
      url: "/api/workspace/sheet-import/preview",
      headers: scoped,
      payload: await batchPayload(["ISOLATED"]),
    });
    assert.equal(previewResponse.statusCode, 200, previewResponse.body);
    const preview = previewResponse.json();
    const confirm = {
      method: "POST" as const,
      url: `/api/workspace/sheet-import/${preview.importId}/confirm`,
      payload: { commandId: preview.commandId },
    };
    assert.equal((await f.app.inject({ ...confirm, headers })).statusCode, 409);
    const response = await f.app.inject({ ...confirm, headers: scoped });
    assert.equal(response.statusCode, 200, response.body);
    const workflows = await f.workspaces.get(id);
    const product = (await workflows.repo.view()).products[0];
    assert.equal(product.code, "ISOLATED");
    assert.equal((await f.workflows.repo.view()).products[0].id, f.product.id);
    await f.db.query("UPDATE assets SET created_at=0");
    await f.workflows.assets.collectUnused();
    assert.ok(
      (
        await workflows.assets.get(
          product.tasks[0].references[0].split("/").at(-1)!,
        )
      ).bytes.length,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/api/products/${f.product.id}`,
          headers: scoped,
        })
      ).statusCode,
      404,
    );
    const member = await new Members(f.db).create({
      username: "merge-viewer",
      displayName: "只读成员",
      role: "viewer",
      monthlyLimit: null,
      password: "viewer-password-123",
    });
    const login = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "merge-viewer", password: "viewer-password-123" },
    });
    assert.equal(login.statusCode, 200, login.body);
    const viewer = {
      cookie: String(login.headers["set-cookie"]).split(";")[0],
    };
    assert.equal(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/api/products/${f.product.id}`,
          headers: viewer,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workspace/sheet-import/preview",
          headers: viewer,
          payload: await batchPayload(["DENIED"]),
        })
      ).statusCode,
      403,
    );
    const staleActor = (await directory.context(member.id, "default"))!;
    await assert.rejects(
      f.workflows.deleteProduct(f.product.id, {
        ...staleActor,
        role: "editor",
      }),
      /不能发起任务/,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/api/products/${product.id}`,
          headers: scoped,
        })
      ).statusCode,
      200,
    );
    assert.equal((await workflows.repo.view()).products.length, 0);
    assert.equal((await f.workflows.repo.view()).products[0].id, f.product.id);
    assert.ok(
      (
        await f.db.query(
          "SELECT id FROM workspace_activity WHERE workspace_id=$1",
          [id],
        )
      ).rows.length >= 2,
    );
  } finally {
    await f.close();
  }
});

test("backend confirms a whole 66-product batch atomically, persists three rows per product and safely replays after restart", async () => {
  const f = await fixture();
  try {
    const original = await f.workflows.repo.view(),
      changed = structuredClone(original);
    changed.products[0].tasks[0].prompt = "已有提示词必须保留";
    const version = addVersion(
      changed.products[0].tasks[0],
      png,
      "已有提示词",
      "imported",
    );
    changed.sheetSnapshot = workflowSnapshot(changed);
    await f.workflows.edit(differences(editable(original), editable(changed)));
    const codes = [
      f.product.code,
      ...Array.from(
        { length: 65 },
        (_, i) => `BATCH-${String(i + 1).padStart(3, "0")}`,
      ),
    ];
    let headers = await loginHeaders(f.app);
    const previewResponse = await f.app.inject({
      method: "POST",
      url: "/api/workspace/sheet-import/preview",
      headers,
      payload: await batchPayload(codes),
    });
    assert.equal(previewResponse.statusCode, 200, previewResponse.body);
    const preview = previewResponse.json();
    assert.equal(preview.candidates.length, 30);
    assert.equal(preview.total, 66);
    assert.equal(preview.created, 65);
    assert.equal(preview.updated, 1);
    assert.equal(
      (await f.workflows.repo.view()).products.length,
      1,
      "preview must not create products",
    );
    assert.doesNotMatch(previewResponse.body, /data:image|\/api\/assets/);
    await f.reopen();
    headers = await loginHeaders(f.app);
    const request = {
      method: "POST" as const,
      url: `/api/workspace/sheet-import/${preview.importId}/confirm`,
      headers,
      payload: { commandId: preview.commandId },
    };
    const response = await f.app.inject(request);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().total, 66);
    assert.deepEqual((await f.app.inject(request)).json(), response.json());
    const saved = await f.workflows.repo.view(),
      sheet = saved.sheetSnapshot.sheets.preview;
    assert.equal(saved.products.length, 66);
    assert.equal(saved.jobs.length, 0);
    assert.equal(Object.keys(sheet.cellData).length, 199);
    assert.equal(sheet.mergeData.length, 198);
    for (const product of parseSheet(sheet, detectColumns(sheet)))
      assert.equal(product.sourceRows.length, 3);
    assert.equal(
      saved.products.find((p) => p.id === f.product.id)!.tasks[0].prompt,
      "已有提示词必须保留",
    );
    assert.equal(
      saved.products.find((p) => p.id === f.product.id)!.tasks[0].primaryId,
      version.id,
    );
    assert.match(
      saved.products.find((p) => p.code === "BATCH-065")!.tasks[0]
        .references[0],
      /^\/api\/assets\//,
    );
    const unchangedPreview = (
      await f.app.inject({
        method: "POST",
        url: "/api/workspace/sheet-import/preview",
        headers,
        payload: await batchPayload(codes),
      })
    ).json();
    assert.equal(unchangedPreview.created, 0);
    assert.equal(unchangedPreview.updated, 0);
    const unchangedConfirm = await f.app.inject({
      method: "POST",
      url: `/api/workspace/sheet-import/${unchangedPreview.importId}/confirm`,
      headers,
      payload: { commandId: unchangedPreview.commandId },
    });
    assert.equal(unchangedConfirm.statusCode, 200, unchangedConfirm.body);
    assert.equal(unchangedConfirm.json().updated, 0);
    assert.deepEqual((await f.workflows.repo.view()).products, saved.products);
    await f.reopen();
    assert.equal((await f.workflows.repo.view()).products.length, 66);
  } finally {
    await f.close();
  }
});

test("backend rejects stale confirmation and duplicate codes without partially adding any products", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const preview = (
      await f.app.inject({
        method: "POST",
        url: "/api/workspace/sheet-import/preview",
        headers,
        payload: await batchPayload([f.product.code, "NEW-ATOMIC"]),
      })
    ).json();
    const state = await f.workflows.repo.view();
    await f.workflows.edit([
      {
        path: ["products", f.product.id, "name"],
        before: state.products[0].name,
        value: "确认期间新名称",
      },
    ]);
    const response = await f.app.inject({
      method: "POST",
      url: `/api/workspace/sheet-import/${preview.importId}/confirm`,
      headers,
      payload: { commandId: preview.commandId },
    });
    assert.equal(response.statusCode, 409, response.body);
    assert.match(response.json().error, /确认期间已被修改/);
    assert.equal((await f.workflows.repo.view()).products.length, 1);
    const duplicate = await f.app.inject({
      method: "POST",
      url: "/api/workspace/sheet-import/preview",
      headers,
      payload: await batchPayload(["DUP", "DUP"]),
    });
    assert.equal(duplicate.statusCode, 400);
    assert.match(duplicate.json().error, /重复/);
  } finally {
    await f.close();
  }
});
