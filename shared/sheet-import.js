import {
  newProduct,
  savePrompt,
  addVersion,
  setPrimary,
  ROLES,
} from "./model.js";
import { productPhotos } from "./prompt-suite.js";
import {
  completeProductRows,
  workflowSnapshot,
  detectColumns,
  columnReader,
  cellText,
  productStatusCell,
  ensureTrailingPhotos,
} from "./sheet-data.js";

function importedContent(product) {
  return {
    name: product.name,
    facts: product.facts,
    photos: productPhotos(product),
    tasks: product.tasks.map((task) => ({
      references: task.references,
      prompt: task.prompt,
      primaryId: task.primaryId,
      selectedIds: task.selectedIds,
    })),
  };
}

function importProducts(state, candidates, authoritative) {
  const byCode = new Map(state.products.map((p) => [p.code, p]));
  let created = 0,
    updated = 0;
  const importedIds = [],
    updatedIds = [];
  for (const source of candidates) {
    let p = byCode.get(source.code);
    const before = p ? JSON.stringify(importedContent(p)) : null;
    if (!p) {
      p = newProduct(source.code, source.name, source.facts);
      state.products.push(p);
      byCode.set(p.code, p);
      created++;
    }
    importedIds.push(p.id);
    if (authoritative && source.present.metadata) {
      p.name = source.name;
      p.facts = source.facts;
    } else {
      p.name = source.name || p.name;
      p.facts = source.facts || p.facts;
    }
    if ((authoritative && source.present.photo) || source.photos.length) {
      if (JSON.stringify(productPhotos(p)) !== JSON.stringify(source.photos)) {
        p.photoThumbnail = null;
        for (const task of p.tasks) delete task.realPhotoIndices;
      }
      p.photos = [...source.photos];
      p.photo = p.photos[0] || "";
    }
    for (const item of source.tasks) {
      const t = p.tasks.find((t) => t.role === item.role);
      if (!t) throw new Error(`产品「${p.code}」缺少${item.role}图片位置`);
      if (
        (authoritative && item.present.references) ||
        item.references.length
      ) {
        if (
          item.references[0] !== t.references[0] ||
          (!item.references.length && !!t.references.length) ||
          (item.references.length > 1 &&
            JSON.stringify(item.references) !== JSON.stringify(t.references))
        ) {
          t.references = [...item.references];
          t.revision++;
        }
      }
      if (
        ((authoritative && item.present.prompt) || item.prompt) &&
        item.prompt !== t.prompt
      )
        savePrompt(t, item.prompt);
      if (item.result) {
        const version =
          t.versions.find((v) => v.source === item.result) ||
          addVersion(t, item.result, item.prompt || t.prompt, "imported");
        setPrimary(t, version.id);
      } else if (authoritative && item.present.result) {
        t.primaryId = null;
        t.selectedIds = [];
      }
    }
    if (before !== null && before !== JSON.stringify(importedContent(p))) {
      updated++;
      updatedIds.push(p.id);
    }
  }
  return { created, updated, importedIds, updatedIds };
}

export function sheetImportCounts(products, candidates) {
  const { created, updated } = importProducts(
    { products: structuredClone(products) },
    candidates,
    false,
  );
  return { created, updated };
}

// One import use case for clipboard parsing and server-side XLSX batches.
// Pure: callers commit the returned workspace atomically through their repository.
export function applySheetImport(
  workspace,
  candidates,
  { authoritative = false, protectDrafts = false } = {},
) {
  const state = structuredClone(workspace);
  const codes = new Set(candidates.map((p) => p.code));
  if (codes.size !== candidates.length) throw new Error("产品编号重复");
  if (!candidates.length) throw new Error("没有可解析的产品");
  const oldSheet = state.sheetSnapshot?.sheets.preview;
  if (protectDrafts && oldSheet) {
    const mapping = detectColumns(oldSheet),
      readCode = columnReader(oldSheet, mapping.codeColumn);
    for (const [row, data] of Object.entries(oldSheet.rowData || {})) {
      const product = state.products.find(
        (p) =>
          p.id === data.custom?.workflowProductId ||
          p.code === cellText(readCode(Number(row))),
      );
      if (
        product &&
        codes.has(product.code) &&
        Object.keys(data.custom?.workflowDrafts || {}).length
      )
        throw new Error(
          `产品「${product.code}」有未解析的表格修改，请先保存或处理后再导入`,
        );
    }
  }
  const { created, updated, importedIds, updatedIds } = importProducts(
    state,
    candidates,
    authoritative,
  );
  if (state.sheetSnapshot)
    ensureTrailingPhotos(state.sheetSnapshot, state.products);
  const completed = state.sheetSnapshot
    ? completeProductRows(state.sheetSnapshot, [...codes])
    : { snapshot: workflowSnapshot(state), rowMap: new Map() };
  state.sheetSnapshot = completed.snapshot;
  const sheet = state.sheetSnapshot.sheets.preview,
    mapping = detectColumns(sheet);
  const readCode = columnReader(sheet, mapping.codeColumn);
  const locations = new Map();
  for (const row of Object.keys(sheet.cellData)) {
    const code = cellText(readCode(Number(row))),
      type = cellText(sheet.cellData[row][mapping.typeColumn]);
    if (!locations.has(`${code}:${type}`))
      locations.set(`${code}:${type}`, Number(row));
  }
  for (const id of importedIds) {
    const p = state.products.find((p) => p.id === id),
      generated = workflowSnapshot({ products: [p] }, { compact: true }).sheets
        .preview;
    const from = detectColumns(generated);
    const bindings = [
      [from.codeColumn, mapping.codeColumn],
      [from.statusColumn, mapping.statusColumn],
      [from.nameColumn, mapping.nameColumn],
      [from.typeColumn, mapping.typeColumn],
      ...from.roles.map((c, i) => [c, mapping.roles[i]]),
      ...from.photoColumns.map((c, i) => [c, mapping.photoColumns?.[i] ?? -1]),
    ];
    let start = locations.get(`${p.code}:示例图`);
    if (start === undefined)
      start = Math.max(0, ...Object.keys(sheet.cellData).map(Number)) + 1;
    for (let kind = 0; kind < 3; kind++) {
      const row = start + kind;
      sheet.cellData[row] ||= {};
      for (const [a, b] of bindings)
        if (b >= 0)
          sheet.cellData[row][b] = structuredClone(
            generated.cellData[kind + 1][a],
          );
      sheet.rowData[row] = {
        ...generated.rowData[kind + 1],
        ...sheet.rowData[row],
        custom: {
          ...sheet.rowData[row]?.custom,
          workflowProductId: p.id,
          workflowDraftVersion: 1,
          workflowDrafts: {},
          workflowDirty: false,
          workflowSaveFailed: false,
        },
      };
      if (kind === 0 && mapping.statusColumn >= 0)
        sheet.cellData[row][mapping.statusColumn] = productStatusCell(
          "已同步",
          true,
        );
    }
    sheet.mergeData = (sheet.mergeData || []).filter(
      (m) =>
        ![mapping.codeColumn, mapping.statusColumn, mapping.nameColumn].some(
          (c) => c >= m.startColumn && c <= m.endColumn,
        ) ||
        m.startRow > start + 2 ||
        m.endRow < start,
    );
    for (const column of [
      mapping.codeColumn,
      mapping.statusColumn,
      mapping.nameColumn,
    ])
      if (column >= 0)
        sheet.mergeData.push({
          startRow: start,
          endRow: start + 2,
          startColumn: column,
          endColumn: column,
        });
    sheet.rowCount = Math.max(sheet.rowCount, start + 3);
  }
  state.activeProductId = importedIds[0];
  return {
    state,
    created,
    updated,
    importedIds,
    updatedIds,
    rowMap: completed.rowMap,
  };
}

// Compare only fields supplied by this import. Background generation can continue
// while the user reads the confirmation, without overwriting newer manual edits.
export function sheetImportBaseline(product, source) {
  if (!product) return null;
  return {
    id: product.id,
    name: source.name ? product.name : null,
    facts: source.facts ? product.facts : null,
    photos: source.photos.length ? productPhotos(product) : null,
    tasks: source.tasks.map((item) => {
      const task = product.tasks.find((t) => t.role === item.role);
      return {
        references: item.references.length ? task.references : null,
        prompt: item.prompt ? task.prompt : null,
        primaryId: item.result ? task.primaryId : null,
      };
    }),
  };
}
