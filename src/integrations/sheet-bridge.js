import { ensureTrailingPhotos } from "../../shared/sheet-data.js";
export { ensureTrailingPhotos } from "../../shared/sheet-data.js";
import {
  applyDefaultRowLayout,
  productStatusCell,
  productStatusWrites,
  preserveSheetRowHeights,
  imageCell,
  workflowSnapshot,
  cellText,
  cellImages,
  sheetCell,
  columnReader,
  completeProductRows,
  detectColumns,
  parseSheet,
  validateSheetParse,
  ROW_TYPES,
  WORKFLOW_ROW_HEIGHTS,
} from "../../shared/sheet-data.js";
export {
  applyDefaultRowLayout,
  productStatusCell,
  productStatusWrites,
  preserveSheetRowHeights,
  imageCell,
  workflowSnapshot,
  cellText,
  cellImages,
  sheetCell,
  columnReader,
  completeProductRows,
  detectColumns,
  parseSheet,
  validateSheetParse,
  ROW_TYPES,
  WORKFLOW_ROW_HEIGHTS,
} from "../../shared/sheet-data.js";
import { ROLES, chosen, uid } from "../../shared/model.js";
import { productPhotos } from "../../shared/prompt-suite.js";
import {
  applySheetSnapshot,
  publishSheetSelection,
  showSheetCollaborators,
} from "./sheet-collaboration.js";
import { readClipboardCells, loadClipboardImage } from "./paste-images.js";

function mergeProductMetadata(snapshot) {
  const sheet = snapshot?.sheets?.preview;
  if (!sheet) return;
  const mapping = detectColumns(sheet);
  if (mapping.typeColumn < 0) return;
  sheet.mergeData ||= [];
  for (const key of Object.keys(sheet.cellData || {})) {
    const row = Number(key);
    if (
      !ROW_TYPES.every(
        (type, offset) =>
          cellText(sheet.cellData[row + offset]?.[mapping.typeColumn]) === type,
      )
    )
      continue;
    const code = cellText(sheetCell(sheet, row, mapping.codeColumn));
    if (
      !code ||
      [1, 2].some((offset) => {
        const next = cellText(
          sheetCell(sheet, row + offset, mapping.codeColumn),
        );
        return next && next !== code;
      })
    )
      continue;
    for (const column of [mapping.codeColumn, mapping.nameColumn]) {
      if (column < 0) continue;
      const value = cellText(sheet.cellData[row]?.[column]);
      // Preserve separately edited metadata and any user-created merge ranges.
      if (
        [1, 2].some((offset) => {
          const cell = sheet.cellData[row + offset]?.[column];
          return (
            cell?.f ||
            cellImages(cell).length ||
            (cellText(cell) && cellText(cell) !== value)
          );
        })
      )
        continue;
      if (
        sheet.mergeData.some(
          (range) =>
            range.startRow <= row + 2 &&
            range.endRow >= row &&
            range.startColumn <= column &&
            range.endColumn >= column,
        )
      )
        continue;
      sheet.mergeData.push({
        startRow: row,
        endRow: row + 2,
        startColumn: column,
        endColumn: column,
      });
      for (const offset of [1, 2]) {
        sheet.cellData[row + offset][column] = {
          ...sheet.cellData[row + offset][column],
          v: "",
          p: null,
        };
      }
    }
  }
}
// Rebuild only confirmed product blocks; retain all other rows and their metadata.
export class SheetBridge {
  isGeneratingRow(row, sheetId = "preview", source = null) {
    if (sheetId !== "preview") return false;
    const sheet = source || this.workbook?.save().sheets.preview;
    if (!sheet) return false;
    const mapping = detectColumns(sheet);
    const productId = sheet.rowData?.[row]?.custom?.workflowProductId;
    const code = cellText(columnReader(sheet, mapping.codeColumn)(row)).trim();
    const product = this.state.products.find(
      (product) => product.id === productId || product.code === code,
    );
    return (
      !!product &&
      this.state.jobs?.some(
        (job) => job.productId === product.id && job.status === "running",
      )
    );
  }
  content(cell) {
    return {
      text: cell?.f ? "" : cellText(cell),
      images: cellImages(cell).map(
        (source) => this.originalImages?.get(source) || source,
      ),
      formula: cell?.f || "",
    };
  }
  sameContent(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  draftCustom(
    row,
    sheet = this.batchSnapshot?.sheets.preview ||
      this.state.sheetSnapshot?.sheets.preview,
  ) {
    return sheet?.rowData?.[row]?.custom || {};
  }
  setDrafts(row, drafts) {
    const sheet = (this.batchSnapshot || this.state.sheetSnapshot)?.sheets
      .preview;
    if (!sheet) return;
    sheet.rowData ||= {};
    sheet.rowData[row] ||= {};
    const custom = {
      ...sheet.rowData[row].custom,
      workflowDraftVersion: 1,
      workflowDrafts: drafts,
      workflowDirty: Object.keys(drafts).length > 0,
    };
    sheet.rowData[row].custom = custom;
    const local = this.pageRows ? this.pageRows.get(row) : row;
    if (local !== undefined && this.workbook?.getSheetBySheetId)
      this.writeRowCustom({ [local]: custom });
    this.dirtyProductCodes = null;
  }
  recordCellEdit(row, column, before, after) {
    const previous = this.content(before),
      next = this.content(after);
    if (this.sameContent(previous, next)) return false;
    const drafts = { ...(this.draftCustom(row).workflowDrafts || {}) };
    const base = drafts[column]?.base || previous;
    const key = `${row}:${column}`,
      conflict = this.conflicts.get(key);
    if (
      this.sameContent(base, next) ||
      (conflict && this.sameContent(this.content(conflict.cell), next))
    )
      delete drafts[column];
    else drafts[column] = { base, value: next };
    this.setDrafts(row, drafts);
    if (conflict && this.sameContent(this.content(conflict.cell), next))
      this.removeConflict(key);
    return true;
  }
  bindProductRows() {
    const sheet = this.state.sheetSnapshot?.sheets.preview;
    if (!sheet) return;
    const products = new Map(this.state.products.map((p) => [p.code, p]));
    sheet.rowData ||= {};
    for (const source of parseSheet(sheet, detectColumns(sheet))) {
      const product = products.get(source.code);
      if (!product) continue;
      for (const key of source.sourceRows) {
        const row = key - 1;
        sheet.rowData[row] ||= {};
        sheet.rowData[row].custom = {
          ...sheet.rowData[row].custom,
          workflowProductId:
            sheet.rowData[row].custom?.workflowProductId || product.id,
        };
      }
    }
  }
  migrateDrafts() {
    const sheet = this.state.sheetSnapshot?.sheets.preview;
    if (!sheet) return;
    const mapping = detectColumns(sheet),
      readCode = columnReader(sheet, mapping.codeColumn);
    const products = new Map(this.state.products.map((p) => [p.code, p]));
    const firstRows = new Set();
    for (const [key, cells] of Object.entries(sheet.cellData || {})) {
      const row = Number(key),
        custom = sheet.rowData?.[row]?.custom;
      const code = cellText(readCode(row)),
        kind = cellText(cells[mapping.typeColumn]);
      const identity = JSON.stringify([code, kind]);
      const first = !firstRows.has(identity);
      firstRows.add(identity);
      if (!custom?.workflowDirty || custom.workflowDraftVersion === 1) continue;
      const drafts = {},
        product = products.get(code);
      for (const [column, cell] of Object.entries(cells)) {
        const c = Number(column);
        if (c === mapping.statusColumn || c === mapping.typeColumn) continue;
        const taskIndex = mapping.roles.indexOf(c);
        let expected;
        if (product && taskIndex >= 0 && first) {
          const task = product.tasks[taskIndex];
          expected =
            kind === "提示词"
              ? { v: task.prompt }
              : kind === "结果图"
                ? imageCell(chosen(task)?.source)
                : imageCell(task.references[0]);
        } else if (product && c === mapping.codeColumn)
          expected = { v: product.code };
        else if (product && c === mapping.nameColumn)
          expected = { v: `${product.name}\n${product.facts}` };
        else if (product && mapping.photoColumns?.includes(c))
          expected = imageCell(
            productPhotos(product)[mapping.photoColumns.indexOf(c)],
          );
        else continue;
        // Old duplicate empty rows were incorrectly marked as product drafts.
        const value = this.content(cell),
          base = this.content(expected);
        if (!this.sameContent(value, base)) drafts[c] = { base: null, value };
      }
      this.setDrafts(row, drafts);
    }
  }
  isProductDirty(product) {
    const sheet = (this.batchSnapshot || this.state.sheetSnapshot)?.sheets
      .preview;
    if (!sheet) return false;
    return parseSheet(sheet, detectColumns(sheet)).some(
      (source) =>
        source.code === product.code &&
        source.sourceRows.some(
          (row) =>
            Object.keys(this.draftCustom(row - 1, sheet).workflowDrafts || {})
              .length,
        ),
    );
  }
  markDirtyRows(rows, sheetId = "preview") {
    if (sheetId !== "preview") return;
    for (const local of rows) {
      const row = this.canonicalRow(local, sheetId);
      this.setDrafts(row, { ...(this.draftCustom(row).workflowDrafts || {}) });
    }
  }
  publishConflicts() {
    this.onConflicts(
      [...this.conflicts].map(([key, item]) => ({
        key,
        message: item.message,
      })),
    );
  }
  removeConflict(key) {
    if (this.conflicts.delete(key)) this.publishConflicts();
  }
  writeSyncedCell(row, column, cell, force = false, description = "") {
    cell = { ...cell, f: null };
    const key = `${row}:${column}`;
    const sheet = (this.batchSnapshot || this.state.sheetSnapshot).sheets
      .preview;
    const current = sheet.cellData[row]?.[column];
    const next = this.content(cell),
      drafts = { ...(this.draftCustom(row).workflowDrafts || {}) };
    const draft = drafts[column];
    if (this.sameContent(this.content(current), next)) {
      if (draft) {
        delete drafts[column];
        this.setDrafts(row, drafts);
      }
      this.removeConflict(key);
      return false;
    }
    if (draft && !force) {
      if (!this.sameContent(draft.base, next)) {
        const message = `${description || "表格"} · ${this.cellAddress(row, column)}：有手动修改，已保留；新生成内容仍保存在产品工作区。`;
        const old = this.conflicts.get(key);
        this.conflicts.set(key, {
          row,
          column,
          cell: structuredClone(cell),
          message,
        });
        if (!old || !this.sameContent(this.content(old.cell), next)) {
          this.publishConflicts();
          this.notify(message);
        }
      } else this.removeConflict(key);
      return false;
    }
    if (draft) {
      delete drafts[column];
      this.setDrafts(row, drafts);
    }
    this.removeConflict(key);
    this.writeCell(row, column, cell);
    return true;
  }
  async retryConflicts() {
    await this.batch(() => {
      for (const [key, conflict] of this.conflicts)
        if (!this.draftCustom(conflict.row).workflowDrafts?.[conflict.column])
          this.writeSyncedCell(conflict.row, conflict.column, conflict.cell);
    });
  }
  cellAddress(row, column) {
    let label = "";
    for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26))
      label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
    return `${label}${row + 1}`;
  }
  resolveConflict(key, prefer) {
    const conflict = this.conflicts.get(key);
    if (!conflict) return;
    if (prefer === "remote")
      this.writeSyncedCell(conflict.row, conflict.column, conflict.cell, true);
    else if (prefer === "local") {
      const drafts = {
        ...(this.draftCustom(conflict.row).workflowDrafts || {}),
      };
      if (drafts[conflict.column])
        drafts[conflict.column] = {
          ...drafts[conflict.column],
          base: this.content(conflict.cell),
        };
      this.setDrafts(conflict.row, drafts);
      this.removeConflict(key);
    } else throw new Error("无效的回填冲突处理方式");
    this.capture();
    this.onChange();
  }
  withSystemWrite(work) {
    const previous = this.systemWrite;
    this.systemWrite = true;
    try {
      return work();
    } finally {
      this.systemWrite = previous;
    }
  }
  // System updates must not occupy undo history or replace a user's redo stack.
  systemMutation(id, params, fallback) {
    return this.withSystemWrite(() => {
      if (!this.api?.syncExecuteCommand) return fallback();
      const result = this.api.syncExecuteCommand(id, {
        unitId: this.workbook.getId(),
        ...params,
      });
      if (result === false) throw new Error("工作表更新未成功执行");
      return result;
    });
  }
  writeRowCustom(custom) {
    return this.systemMutation(
      "sheet.mutation.set-row-data",
      {
        subUnitId: "preview",
        rowData: Object.fromEntries(
          Object.entries(custom).map(([row, value]) => [
            row,
            { custom: value },
          ]),
        ),
      },
      () => this.workbook.getSheetBySheetId("preview").setRowCustom(custom),
    );
  }
  isStatusColumn(column, sheetId = "preview") {
    if (sheetId !== "preview") return false;
    const sheet =
      this.workbook?.save().sheets.preview ||
      this.state.sheetSnapshot?.sheets.preview;
    return sheet && column === detectColumns(sheet).statusColumn;
  }
  installStatusReadOnly() {
    this.statusEditSubscription = this.api.addEvent(
      this.api.Event.BeforeSheetEditStart,
      (event) => {
        if (!this.isStatusColumn(event.column, event.worksheet.getSheetId()))
          return;
        event.cancel = true;
        this.notify("状态由系统自动更新，不能手动修改");
      },
    );
    this.statusWriteSubscription = this.api.addEvent(
      this.api.Event.BeforeCommandExecute,
      (event) => {
        if (
          event.id === "sheet.command.paste-by-short-key" &&
          event.params?.textContent &&
          /[\r\n]/.test(event.params.textContent) &&
          !/\t/.test(event.params.textContent) &&
          !/<table\b/i.test(event.params.htmlContent || "") &&
          !event.params.files?.length
        ) {
          const sheet = this.workbook.getActiveSheet();
          const range = sheet.getActiveRange();
          const source = this.workbook.save().sheets[sheet.getSheetId()];
          const mapping = detectColumns(source);
          if (
            sheet.getSheetId() === "preview" &&
            range?.getHeight() === 1 &&
            range.getWidth() === 1 &&
            mapping.roles.includes(range.getColumn()) &&
            cellText(
              source.cellData[range.getRow()]?.[mapping.typeColumn],
            ).trim() === "提示词"
          ) {
            const escaped = event.params.textContent
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/\r\n|\r|\n/g, "<br>");
            event.params.htmlContent = `<table><tr><td>${escaped}</td></tr></table>`;
          }
        }
        if (
          this.systemWrite ||
          event.id !== "sheet.mutation.set-range-values" ||
          event.params?.subUnitId !== "preview"
        )
          return;
        const source = this.workbook.save().sheets.preview;
        const column = detectColumns(source).statusColumn;
        if (column < 0) return;
        for (const [key, cells] of Object.entries(
          event.params.cellValue || {},
        )) {
          const local = Number(key);
          if (cells) delete cells[column];
          if (local <= 0) continue;
          for (const [col, patch] of Object.entries(cells || {})) {
            if (
              patch &&
              !["v", "p", "f"].some((field) => Object.hasOwn(patch, field))
            )
              continue;
            const before = source.cellData[local]?.[col];
            const after = patch == null ? null : { ...before, ...patch };
            if (
              after &&
              Object.hasOwn(patch, "v") &&
              !Object.hasOwn(patch, "p")
            )
              after.p = null;
            if (!this.sameContent(this.content(before), this.content(after)))
              this.recordCellEdit(
                this.canonicalRow(local, "preview"),
                Number(col),
                before,
                after,
              );
          }
        }
      },
    );
  }
  ensureStatusColumn() {
    const source = this.workbook.save().sheets.preview;
    if (!source) return;
    const mapping = detectColumns(source);
    if (mapping.headerRow < 0 || mapping.statusColumn >= 0) return;
    const sheet = this.workbook.getSheetBySheetId("preview");
    const column = mapping.codeColumn + 1;
    sheet.insertColumnBefore(column);
    sheet.setColumnWidth(column, 90);
    sheet.getRange(mapping.headerRow, column).setValue({
      v: "状态",
      s: source.cellData[mapping.headerRow][mapping.codeColumn]?.s,
    });
    for (const product of parseSheet(source, mapping)) {
      const start = product.sourceRows[0] - 1;
      const end = product.sourceRows.at(-1) - 1;
      sheet.getRange(start, column).setValue(productStatusCell("新建产品"));
      if (end > start)
        sheet.getRange(start, column, end - start + 1, 1).merge();
    }
    if (source.freeze?.xSplit > column)
      sheet.setFrozenColumns(source.freeze.xSplit + 1);
  }
  markProductParsed(code) {
    const product = this.state.products.find(
      (product) => product.code === code,
    );
    if (product) this.knownProducts.add(product.id);
    const snapshot = this.snapshot();
    const sheet = snapshot.sheets.preview;
    const mapping = detectColumns(sheet);
    if (mapping.statusColumn < 0) return;
    for (const source of parseSheet(sheet, mapping)) {
      if (source.code === code) {
        const custom = {};
        for (const sourceRow of source.sourceRows) {
          const row = sourceRow - 1;
          sheet.rowData[row] ||= {};
          sheet.rowData[row].custom = {
            ...sheet.rowData[row].custom,
            workflowProductId:
              product?.id || sheet.rowData[row].custom?.workflowProductId,
            workflowDirty: false,
            workflowSaveFailed: false,
            workflowDraftVersion: 1,
            workflowDrafts: {},
          };
          for (const key of this.conflicts.keys())
            if (key.startsWith(`${row}:`)) this.removeConflict(key);
          const local = this.pageRows ? this.pageRows.get(row) : row;
          if (local !== undefined) custom[local] = sheet.rowData[row].custom;
        }
        if (this.workbook) this.writeRowCustom(custom);
        this.writeCell(
          source.sourceRows[0] - 1,
          mapping.statusColumn,
          productStatusCell("已同步", true),
        );
      }
    }
    this.dirtyProductCodes = null;
  }
  /**
   * @param {any} state
   * @param {() => void} onChange
   * @param {(message: string) => void} notify
   * @param {(items: {key: string, message: string}[]) => void} [onConflicts]
   */
  constructor(state, onChange, notify, onConflicts = () => {}) {
    this.state = state;
    this.onChange = onChange;
    this.notify = notify;
    this.api = null;
    this.workbook = null;
    this.knownProducts = new Set(state.products.map((p) => p.id));
    this.onConflicts = onConflicts;
    this.conflicts = new Map();
    this.initializeSnapshot();
  }
  initializeSnapshot() {
    const state = this.state;
    ensureTrailingPhotos(state.sheetSnapshot, state.products);
    applyDefaultRowLayout(state.sheetSnapshot);
    preserveSheetRowHeights(state.sheetSnapshot);
    if (!state.sheetMetadataMergeVersion) {
      mergeProductMetadata(state.sheetSnapshot);
      state.sheetMetadataMergeVersion = 1;
    }
    this.bindProductRows();
    this.migrateDrafts();
  }
  async mount() {
    if (this.disposed || this.workbook) return;
    const [presets, core, coreLocale, drawing, drawingLocale] =
      await Promise.all([
        import("@univerjs/presets"),
        import("@univerjs/preset-sheets-core"),
        import("@univerjs/preset-sheets-core/locales/zh-CN"),
        import("@univerjs/preset-sheets-drawing"),
        import("@univerjs/preset-sheets-drawing/locales/zh-CN"),
        import("@univerjs/preset-sheets-core/lib/index.css"),
        import("@univerjs/preset-sheets-drawing/lib/index.css"),
      ]);
    if (this.disposed || this.workbook) return;
    const { createUniver, LocaleType, mergeLocales } = presets;
    const { UniverSheetsCorePreset } = core;
    const { UniverSheetsDrawingPreset } = drawing;
    const CoreZhCN = coreLocale.default,
      DrawingZhCN = drawingLocale.default;
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.ZH_CN,
      locales: { [LocaleType.ZH_CN]: mergeLocales(CoreZhCN, DrawingZhCN) },
      presets: [
        UniverSheetsCorePreset({ container: "sheet-container" }),
        UniverSheetsDrawingPreset(),
      ],
    });
    this.api = univerAPI;
    this.univer = univer;
    const existing = this.state.sheetSnapshot?.sheets.preview;
    if (existing && detectColumns(existing).statusColumn < 0) {
      this.workbook = univerAPI.createWorkbook(this.state.sheetSnapshot);
      this.ensureStatusColumn();
      this.state.sheetSnapshot = this.workbook.save();
      univerAPI.disposeUnit(this.workbook.getId());
      this.workbook = null;
    }
    this.workbook = univerAPI.createWorkbook(this.project());
    this.ensureStatusColumn();
    this.installStatusReadOnly();
    this.installPageGuards();
    if (import.meta.env.MODE === "demo") window.demoAPI = univerAPI;
    this.valueSubscription = this.api.addEvent(
      this.api.Event.CommandExecuted,
      (event) => {
        if (this.receivingRemote || this.systemWrite) return;
        if (
          event.id.includes("set-selections") ||
          event.id.includes("set-worksheet-active")
        )
          this.publishSelection();
        if (!event.id.startsWith("sheet.mutation.")) return;
        clearTimeout(this.captureTimer);
        this.captureTimer = setTimeout(async () => {
          try {
            this.capture();
            if (this.conflicts.size) await this.retryConflicts();
            this.onChange();
          } catch (error) {
            this.notify(`表格更新失败：${error.message}`);
          }
        }, 400);
      },
    );
    this.capture();
    this.publishSelection();
    this.showCollaborators(this.peers || []);
  }
  publishSelection(event) {
    publishSheetSelection(this, event);
  }
  showCollaborators(peers) {
    showSheetCollaborators(this, peers);
  }
  acceptRemoteSnapshot(previous) {
    applySheetSnapshot(this, previous);
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.captureTimer);
    this.valueSubscription?.dispose();
    this.showCollaborators([]);
    this.structureSubscription?.dispose();
    this.pageEditSubscription?.dispose();
    this.statusEditSubscription?.dispose();
    this.statusWriteSubscription?.dispose();
    this.api?.dispose();
    this.univer?.dispose();
    this.workbook = null;
    this.api = null;
  }
  // The canonical snapshot always contains every product. Only this projection
  // is mounted in Univer; all domain writes use canonical coordinates.
  setProducts(products) {
    const embedded = new Set(
      Object.values(
        this.state.sheetSnapshot?.sheets?.preview?.rowData || {},
      ).map((row) => row.custom?.workflowProductId),
    );
    for (const product of this.state.products) {
      if (!this.knownProducts.has(product.id)) {
        this.knownProducts.add(product.id);
        if (!embedded.has(product.id)) this.appendProduct(product);
      }
    }
    const required = Math.max(
      6,
      ...this.state.products.map((p) => productPhotos(p).length),
    );
    const existing = this.state.sheetSnapshot?.sheets?.preview;
    let resized = false;
    if (
      existing &&
      (detectColumns(existing).photoColumns?.length || 0) < required
    ) {
      this.capture();
      resized = ensureTrailingPhotos(
        this.state.sheetSnapshot,
        this.state.products,
      );
    }
    const ids =
      products.map((p) => `${p.id}:${p.code}`).join(",") +
      `:photos:${required}`;
    if (ids === this.pageKey && !resized) return;
    if (!resized) this.capture();
    this.pageKey = ids;
    this.pageCodes = new Set(products.map((p) => p.code));
    this.pageIds = new Set(products.map((p) => p.id));
    if (this.workbook) {
      clearTimeout(this.captureTimer);
      const id = this.workbook.getId();
      this.workbook = null;
      this.api.disposeUnit(id);
      this.workbook = this.api.createWorkbook(this.project());
      this.showCollaborators(this.peers || []);
      this.publishSelection();
    }
  }
  project() {
    const full = this.state.sheetSnapshot || workflowSnapshot(this.state);
    this.state.sheetSnapshot = full;
    this.ensureCanonicalStatusColumn();
    if (!this.pageCodes) return full;
    const sheet = full.sheets.preview;
    if (!sheet) return full;
    const mapping = detectColumns(sheet);
    const readCode = columnReader(sheet, mapping.codeColumn);
    const knownCodes = new Set(
      this.state.products.map((product) => product.code),
    );
    const draftRows = new Set(
      parseSheet(sheet, mapping)
        .filter(
          (product) =>
            !knownCodes.has(product.code) &&
            !product.sourceRows.some(
              (row) => sheet.rowData?.[row - 1]?.custom?.workflowProductId,
            ),
        )
        .flatMap((product) => product.sourceRows.map((row) => row - 1)),
    );
    const rows = Object.keys(sheet.cellData)
      .map(Number)
      .sort((a, b) => a - b)
      .filter(
        (row) =>
          row <= Math.max(0, mapping.headerRow) ||
          draftRows.has(row) ||
          this.pageCodes.has(cellText(readCode(row))) ||
          this.pageIds?.has(sheet.rowData?.[row]?.custom?.workflowProductId),
      );
    this.pageRows = new Map(rows.map((row, index) => [row, index]));
    this.originalImages = new Map();
    const projected = structuredClone({
      ...full,
      sheets: {
        ...full.sheets,
        preview: { ...sheet, cellData: {}, rowData: {}, mergeData: [] },
      },
    });
    const preview = projected.sheets.preview;
    preview.rowCount = Math.max(100, rows.length + 5);
    for (const [original, local] of this.pageRows) {
      const cells = structuredClone(sheet.cellData[original]);
      for (const cell of Object.values(cells)) {
        for (const drawing of Object.values(cell?.p?.drawings || {})) {
          if (/^\/api\/assets\/[a-f0-9]{64}$/.test(drawing.source)) {
            const thumbnail = drawing.source + "/thumbnail";
            this.originalImages.set(thumbnail, drawing.source);
            drawing.source = thumbnail;
          }
        }
      }
      preview.cellData[local] = cells;
      if (sheet.rowData?.[original])
        preview.rowData[local] = structuredClone(sheet.rowData[original]);
    }
    preview.mergeData = (sheet.mergeData || [])
      .filter(
        (m) => this.pageRows.has(m.startRow) && this.pageRows.has(m.endRow),
      )
      .map((m) => ({
        ...m,
        startRow: this.pageRows.get(m.startRow),
        endRow: this.pageRows.get(m.endRow),
      }));
    this.projection = projected;
    return projected;
  }
  capture() {
    if (this.batchSnapshot) return this.batchSnapshot;
    this.dirtyProductCodes = null;
    if (this.workbook) {
      const saved = this.workbook.save();
      if (!this.pageRows) this.state.sheetSnapshot = saved;
      else {
        const full = this.state.sheetSnapshot;
        const local = saved.sheets.preview;
        if (local && full.sheets.preview) {
          for (const [original, row] of this.pageRows) {
            const cells = structuredClone(local.cellData[row] || {});
            for (const cell of Object.values(cells))
              for (const drawing of Object.values(cell?.p?.drawings || {}))
                drawing.source =
                  this.originalImages.get(drawing.source) || drawing.source;
            full.sheets.preview.cellData[original] = cells;
            if (local.rowData?.[row])
              full.sheets.preview.rowData[original] = local.rowData[row];
          }
          full.styles = saved.styles;
          full.sheets.preview.columnData = local.columnData;
          const originalRows = new Map(
            [...this.pageRows].map(([original, row]) => [row, original]),
          );
          full.sheets.preview.mergeData = (
            full.sheets.preview.mergeData || []
          ).filter(
            (range) =>
              !this.pageRows.has(range.startRow) ||
              !this.pageRows.has(range.endRow),
          );
          for (const range of local.mergeData || []) {
            const startRow = originalRows.get(range.startRow);
            const endRow = originalRows.get(range.endRow);
            if (
              startRow !== undefined &&
              endRow - startRow === range.endRow - range.startRow
            )
              full.sheets.preview.mergeData.push({
                ...range,
                startRow,
                endRow,
              });
          }
        }
        for (const [id, sheet] of Object.entries(saved.sheets))
          if (id !== "preview") full.sheets[id] = sheet;
      }
    }
    const snapshot = this.state.sheetSnapshot;
    if (snapshot) {
      let source = snapshot;
      if (this.pageRows)
        source = {
          ...snapshot,
          sheets: {
            ...snapshot.sheets,
            preview: {
              ...snapshot.sheets.preview,
              cellData: Object.fromEntries(
                Object.entries(snapshot.sheets.preview.cellData).filter(
                  ([row]) => this.pageRows.has(Number(row)),
                ),
              ),
            },
          },
        };
      for (const sheetId of Object.keys(snapshot.sheets))
        for (const { row, column, cell } of productStatusWrites(
          source,
          this.state.products,
          sheetId,
        )) {
          snapshot.sheets[sheetId].cellData[row][column] = cell;
          const local =
            sheetId === "preview" && this.pageRows
              ? this.pageRows.get(row)
              : row;
          if (local !== undefined && this.workbook?.getSheetBySheetId)
            this.systemMutation(
              "sheet.mutation.set-range-values",
              {
                subUnitId: sheetId,
                cellValue: { [local]: { [column]: cell } },
              },
              () =>
                this.workbook
                  .getSheetBySheetId(sheetId)
                  .getRange(local, column, 1, 1)
                  .setValue(cell),
            );
        }
    }
    return snapshot;
  }
  ensureCanonicalStatusColumn() {
    const sheet = this.state.sheetSnapshot?.sheets?.preview;
    if (!sheet || detectColumns(sheet).statusColumn >= 0) return;
    const shift = (values) =>
      Object.fromEntries(
        Object.entries(values || {}).map(([column, value]) => [
          Number(column) >= 1 ? Number(column) + 1 : column,
          value,
        ]),
      );
    for (const row of Object.keys(sheet.cellData))
      sheet.cellData[row] = shift(sheet.cellData[row]);
    sheet.columnData = shift(sheet.columnData);
    for (const data of Object.values(sheet.rowData || {}))
      if (data.custom?.workflowDrafts)
        data.custom.workflowDrafts = shift(data.custom.workflowDrafts);
    sheet.columnData[1] = { w: 90 };
    sheet.columnCount++;
    sheet.cellData[0][1] = { v: "状态", s: "header" };
    for (const merge of sheet.mergeData || []) {
      if (merge.startColumn >= 1) merge.startColumn++;
      if (merge.endColumn >= 1) merge.endColumn++;
    }
  }
  installPageGuards() {
    this.structureSubscription?.dispose();
    this.pageEditSubscription?.dispose();
    this.pageEditSubscription = this.api.addEvent(
      this.api.Event.BeforeSheetEditStart,
      (event) => {
        if (
          this.pageRows &&
          event.worksheet.getSheetId() === "preview" &&
          !new Set(this.pageRows.values()).has(event.row)
        ) {
          this.ensurePageRow(event.row);
        }
      },
    );
    this.structureSubscription = this.api.addEvent(
      this.api.Event.BeforeCommandExecute,
      (event) => {
        if (
          !this.pageRows ||
          this.workbook?.getActiveSheet()?.getSheetId() !== "preview"
        )
          return;
        if (
          !this.systemWrite &&
          /^sheet\.command\.remove-row(?:-by-range)?$/.test(event.id)
        ) {
          event.cancel = true;
          const range = event.params?.range;
          const rows = range
            ? Array.from(
                { length: range.endRow - range.startRow + 1 },
                (_, i) => range.startRow + i,
              )
            : this.selectedRows();
          queueMicrotask(() => {
            try {
              this.removeDraftRows(rows);
            } catch (error) {
              this.notify(error.message);
            }
          });
          return;
        }
        if (
          !this.systemWrite &&
          event.id === "sheet.mutation.set-range-values" &&
          event.params?.subUnitId === "preview"
        ) {
          const rows = new Set(this.pageRows.values());
          for (const [row, cells] of Object.entries(
            event.params.cellValue || {},
          )) {
            if (rows.has(Number(row))) continue;
            // Clipboard mutations can include trailing empty cells. They do not
            // need a product row. Actual pasted content gets new canonical rows.
            if (
              Object.values(cells || {}).some(
                (cell) =>
                  cell && (cellText(cell) || cell.f || cellImages(cell).length),
              )
            )
              this.ensurePageRow(Number(row));
            else delete event.params.cellValue[row];
          }
        }
        if (
          !this.systemWrite &&
          /^sheet\.command\.(?:insert-(?:row|col)|remove-(?:row|col)|move-(?:rows|cols)|sort|merge|unmerge)/.test(
            event.id,
          )
        ) {
          event.cancel = true;
          this.notify(
            "分页工作表请通过产品集合增删产品；批量导入请使用「外部粘贴」",
          );
        }
      },
    );
  }
  canonicalRow(local, sheetId) {
    if (sheetId !== "preview" || !this.pageRows) return local;
    for (const [original, row] of this.pageRows)
      if (row === local) return original;
    return this.ensurePageRow(local);
  }
  ensurePageRow(local) {
    for (const [original, row] of this.pageRows)
      if (row === local) return original;
    const sheet = this.state.sheetSnapshot.sheets.preview;
    let original = Math.max(
      0,
      ...Object.keys(sheet.cellData).map(Number),
      ...this.pageRows.keys(),
    );
    const lastLocal = Math.max(0, ...this.pageRows.values());
    for (let row = lastLocal + 1; row <= local; row++) {
      this.pageRows.set(++original, row);
      sheet.cellData[original] = {};
      const height = WORKFLOW_ROW_HEIGHTS[(row - 1) % 3];
      sheet.rowData[original] = { h: height, ia: 0 };
      this.withSystemWrite(() =>
        this.workbook.getSheetBySheetId("preview").setRowHeight(row, height),
      );
    }
    sheet.rowCount = Math.max(sheet.rowCount, original + 1);
    this.batchLocations = null;
    return original;
  }
  parserSource() {
    this.capture();
    const source =
      this.workbook.save().sheets[this.workbook.getActiveSheet().getSheetId()];
    for (const cells of Object.values(source.cellData || {}))
      for (const cell of Object.values(cells))
        for (const drawing of Object.values(cell?.p?.drawings || {}))
          drawing.source =
            this.originalImages?.get(drawing.source) || drawing.source;
    return source;
  }
  completeProductRows(codes) {
    const result = completeProductRows(this.snapshot(), codes);
    if (!result.changed) return;
    this.replaceSnapshot(result.snapshot, result.rowMap);
  }
  replaceSnapshot(
    snapshot,
    rowMap = new Map(),
    { preserveScroll = false } = {},
  ) {
    clearTimeout(this.captureTimer);
    const workbook = this.workbook;
    const activeSheet = workbook?.getActiveSheet?.();
    const active = activeSheet?.getSheetId();
    const scroll = preserveScroll ? activeSheet?.getScrollState?.() : null;
    this.workbook = null;
    if (workbook) this.api.disposeUnit(workbook.getId());
    this.state.sheetSnapshot = snapshot;
    this.pageRows = null;
    this.batchLocations = null;
    this.conflicts = new Map(
      [...this.conflicts].map(([, conflict]) => {
        const row = rowMap.get(conflict.row) ?? conflict.row;
        const message = conflict.message.replace(
          ` · ${this.cellAddress(conflict.row, conflict.column)}：`,
          ` · ${this.cellAddress(row, conflict.column)}：`,
        );
        return [`${row}:${conflict.column}`, { ...conflict, row, message }];
      }),
    );
    if (workbook) {
      this.workbook = this.api.createWorkbook(this.project());
      if (active) this.workbook.setActiveSheet(active);
      if (scroll) {
        const restored = this.workbook;
        requestAnimationFrame(() => {
          if (this.workbook !== restored || this.disposed) return;
          this.api.syncExecuteCommand("sheet.command.scroll-view", {
            ...scroll,
            unitId: restored.getId(),
            sheetId: active,
            duration: 0,
          });
        });
      }
    }
    this.publishConflicts();
  }
  async withRemoteWorkspace(work) {
    this.capture();
    clearTimeout(this.captureTimer);
    const previous = this.workbook;
    this.workbook = null;
    if (previous) this.api.disposeUnit(previous.getId());
    this.pageRows = null;
    this.pageKey = null;
    try {
      const result = await work();
      this.conflicts.clear();
      this.publishConflicts();
      const errors = await this.reconcile();
      if (errors.length) this.notify("结果已保留，表格回填失败：" + errors[0]);
      return result;
    } finally {
      if (previous) this.workbook = this.api.createWorkbook(this.project());
    }
  }
  selectedRows() {
    const range = this.workbook?.getActiveSheet()?.getActiveRange();
    if (!range) return [];
    return Array.from(
      { length: range.getHeight() },
      (_, i) => range.getRow() + i,
    );
  }
  removeDraftRows(localRows = this.selectedRows()) {
    const sheetId = this.workbook?.getActiveSheet()?.getSheetId() || "preview";
    const snapshot = this.snapshot(),
      sheet = snapshot.sheets[sheetId];
    if (!sheet) return;
    const mapping = detectColumns(sheet),
      sources = parseSheet(sheet, mapping);
    const rows = new Set();
    for (const local of localRows) {
      const row =
        sheetId === "preview" && this.pageRows
          ? [...this.pageRows].find(([, index]) => index === local)?.[0]
          : local;
      if (row === undefined || !sheet.cellData[row]) continue;
      if (row <= mapping.headerRow) throw new Error("不能删除表头行");
      const product = sources.find((p) => p.sourceRows.includes(row + 1));
      if (
        sheetId === "preview" &&
        product &&
        this.state.products.some((p) => p.code === product.code)
      )
        throw new Error(
          "该产品已在工作区中，请通过产品集合管理；此处仅删除尚未解析的新产品行",
        );
      for (const original of product?.sourceRows.map((r) => r - 1) || [row])
        rows.add(original);
    }
    if (!rows.size) return;
    for (const row of rows) {
      delete sheet.cellData[row];
      delete sheet.rowData[row];
    }
    sheet.mergeData = (sheet.mergeData || []).filter(
      (m) => ![...rows].some((row) => row >= m.startRow && row <= m.endRow),
    );
    if (sheetId === "preview")
      for (const [key, conflict] of this.conflicts)
        if (rows.has(conflict.row)) this.conflicts.delete(key);
    this.replaceSnapshot(snapshot, new Map(), { preserveScroll: true });
    this.capture();
    this.onChange();
    this.notify(`已删除 ${rows.size} 行待解析数据`);
  }
  snapshot() {
    return this.capture() || workflowSnapshot(this.state);
  }
  async batch(work) {
    if (!this.state.sheetSnapshot && !this.workbook) return work();
    if (this.batchSnapshot) return work();
    this.batchSnapshot = this.snapshot();
    this.batchWrites = new Map();
    this.batchUserEdit = false;
    try {
      return await work();
    } finally {
      try {
        if (this.workbook && !this.disposed)
          for (const [sheetId, cells] of this.batchWrites) {
            // Sparse matrices use absolute coordinates and leave untouched cells alone.
            const local = this.localWrites(cells, sheetId);
            if (!Object.keys(local).length) continue;
            const write = () =>
              this.workbook
                .getSheetBySheetId(sheetId)
                .getRange(0, 0, 1, 1)
                .setValues(local);
            if (this.batchUserEdit) this.withSystemWrite(write);
            else
              this.systemMutation(
                "sheet.mutation.set-range-values",
                { subUnitId: sheetId, cellValue: local },
                write,
              );
          }
      } finally {
        this.state.sheetSnapshot = this.batchSnapshot;
        this.batchSnapshot = null;
        this.batchWrites = null;
        this.batchLocations = null;
        this.batchUserEdit = false;
        this.capture();
      }
    }
  }
  previewCell(cell) {
    const result = structuredClone(cell);
    for (const drawing of Object.values(result?.p?.drawings || {}))
      if (/^\/api\/assets\/[a-f0-9]{64}$/.test(drawing.source)) {
        const original = drawing.source;
        drawing.source += "/thumbnail";
        this.originalImages?.set(drawing.source, original);
      }
    return result;
  }
  localWrites(cells, sheetId) {
    if (sheetId !== "preview" || !this.pageRows) return cells;
    return Object.fromEntries(
      Object.entries(cells)
        .filter(([row]) => this.pageRows.has(Number(row)))
        .map(([row, values]) => [
          this.pageRows.get(Number(row)),
          Object.fromEntries(
            Object.entries(values).map(([column, cell]) => [
              column,
              this.previewCell(cell),
            ]),
          ),
        ]),
    );
  }
  writeUserCell(row, column, cell, sheetId = "preview") {
    if (sheetId === "preview") {
      const sheet = (this.batchSnapshot || this.state.sheetSnapshot).sheets
        .preview;
      this.recordCellEdit(row, column, sheet.cellData[row]?.[column], cell);
    }
    if (this.batchWrites) this.batchUserEdit = true;
    this.writeCell(row, column, cell, sheetId, true);
  }
  writeCell(row, column, cell, sheetId = "preview", userEdit = false) {
    if (this.batchSnapshot || !this.workbook) {
      const sheet = this.snapshot().sheets[sheetId];
      sheet.cellData[row] ||= {};
      sheet.cellData[row][column] = cell;
      if (this.batchWrites) {
        if (!this.batchWrites.has(sheetId)) this.batchWrites.set(sheetId, {});
        const writes = this.batchWrites.get(sheetId);
        writes[row] ||= {};
        writes[row][column] = cell;
      }
    } else {
      const canonical = this.state.sheetSnapshot.sheets[sheetId];
      canonical.cellData[row] ||= {};
      canonical.cellData[row][column] = cell;
      const localRow =
        sheetId === "preview" && this.pageRows ? this.pageRows.get(row) : row;
      if (localRow !== undefined) {
        const value = this.previewCell(cell);
        const write = () =>
          this.workbook
            .getSheetBySheetId(sheetId)
            .getRange(localRow, column, 1, 1)
            .setValue(value);
        if (userEdit) this.withSystemWrite(write);
        else
          this.systemMutation(
            "sheet.mutation.set-range-values",
            {
              subUnitId: sheetId,
              cellValue: { [localRow]: { [column]: value } },
            },
            write,
          );
      }
    }
  }
  locate(product, task, kind) {
    const snapshot = this.snapshot(),
      sheet = snapshot.sheets.preview;
    if (!sheet) throw new Error("工作流预览表已被删除，请恢复表格后回填");
    const mapping = this.batchLocations?.mapping || detectColumns(sheet),
      column = mapping.roles[ROLES.indexOf(task.role)];
    const type =
      kind === "prompt" ? "提示词" : kind === "reference" ? "示例图" : "结果图";
    let locations = this.batchLocations?.rows;
    if (!locations) {
      locations = new Map();
      const readCode = columnReader(sheet, mapping.codeColumn);
      for (const r of Object.keys(sheet.cellData)) {
        const code = cellText(readCode(Number(r)));
        const label = cellText(sheet.cellData[r][mapping.typeColumn]);
        const key = JSON.stringify([code, label]);
        if (!locations.has(key)) locations.set(key, Number(r));
        const id = sheet.rowData?.[r]?.custom?.workflowProductId;
        if (id) {
          const stable = JSON.stringify(["id", id, label]);
          if (!locations.has(stable)) locations.set(stable, Number(r));
        }
      }
      if (this.batchSnapshot)
        this.batchLocations = { mapping, rows: locations };
    }
    const row =
      locations.get(JSON.stringify(["id", product.id, type])) ??
      locations.get(JSON.stringify([product.code, type]));
    if (row === undefined || column < 0)
      throw new Error(
        `${product.code} ${task.role} 的回填位置缺失，请恢复对应编号和内容标签`,
      );
    return { row: Number(row), column };
  }
  async sync(product, task, kind, force = false) {
    // A snapshot is maintained even before the user opens the spreadsheet view.
    if (!this.state.sheetSnapshot && !this.workbook) return;
    const { row, column } = this.locate(product, task, kind);
    const cell =
      kind === "prompt"
        ? { v: task.prompt, p: null, s: "prompt" }
        : imageCell(
            kind === "reference" ? task.references[0] : chosen(task)?.source,
          );
    this.writeSyncedCell(
      row,
      column,
      cell,
      force,
      `${product.code} · ${task.role} · ${kind === "prompt" ? "提示词" : kind === "result" ? "结果图" : "参考图"}`,
    );
    this.capture();
  }
  async reconcile() {
    const errors = new Set();
    if (!this.state.sheetSnapshot) return [];
    await this.batch(async () => {
      for (const product of this.state.products)
        if (!product._summary)
          for (const task of product.tasks) {
            try {
              for (const kind of ["reference", "prompt", "result"])
                await this.sync(product, task, kind);
            } catch (error) {
              errors.add(error.message);
            }
          }
    });
    return [...errors];
  }
  appendProduct(product) {
    this.knownProducts.add(product.id);
    if (!this.state.sheetSnapshot && !this.workbook) return;
    const generated = workflowSnapshot({ ...this.state, products: [product] })
      .sheets.preview;
    const snapshot = this.snapshot(),
      sheet = snapshot.sheets.preview,
      mapping = detectColumns(sheet);
    const generatedMapping = detectColumns(generated);
    const bindings = [
      [generatedMapping.codeColumn, mapping.codeColumn],
      [generatedMapping.statusColumn, mapping.statusColumn],
      [generatedMapping.nameColumn, mapping.nameColumn],
      [generatedMapping.typeColumn, mapping.typeColumn],
      ...generatedMapping.roles.map((column, i) => [column, mapping.roles[i]]),
      ...generatedMapping.photoColumns.map((column, i) => [
        column,
        mapping.photoColumns?.[i] ?? -1,
      ]),
    ];
    const last = Math.max(0, ...Object.keys(sheet.cellData).map(Number));
    for (let i = 1; i <= 3; i++) {
      const row = last + i;
      if (this.workbook && !this.pageRows) {
        const target = this.workbook.getSheetBySheetId("preview");
        if (row >= sheet.rowCount) {
          target.insertRows(sheet.rowCount, 100);
          sheet.rowCount += 100;
        }
        for (const [c, to] of bindings)
          if (to >= 0) this.writeCell(row, to, generated.cellData[i][c]);
        target.setRowHeight(row, generated.rowData[i].h);
      } else {
        sheet.cellData[row] = Object.fromEntries(
          bindings
            .map(([c, to]) => [to, generated.cellData[i][c]])
            .filter(([to]) => to >= 0),
        );
        sheet.rowData[row] = generated.rowData[i];
        sheet.rowCount = Math.max(sheet.rowCount, row + 1);
      }
    }
    for (const column of [
      mapping.codeColumn,
      mapping.statusColumn,
      mapping.nameColumn,
    ]) {
      if (column < 0) continue;
      if (this.workbook && !this.pageRows)
        this.workbook
          .getSheetBySheetId("preview")
          .getRange(last + 1, column, 3, 1)
          .merge();
      else {
        sheet.mergeData ||= [];
        sheet.mergeData.push({
          startRow: last + 1,
          endRow: last + 3,
          startColumn: column,
          endColumn: column,
        });
      }
    }
    this.batchLocations = null;
    this.capture();
  }
  async paste(
    clipboard,
    cells = readClipboardCells(
      clipboard.getData("text/html"),
      clipboard.getData("text/plain"),
    ),
  ) {
    if (!this.workbook) return false;
    let items = cells.flatMap((cell) =>
      cell.urls.map((url, index) => ({
        row: cell.row,
        column: cell.column + index,
        url,
      })),
    );
    if (!items.length)
      [...clipboard.files]
        .filter((f) => f.type.startsWith("image/"))
        .forEach((file, column) => items.push({ row: 0, column, file }));
    if (!items.length) return false;
    const sheet = this.workbook.getActiveSheet(),
      range = sheet.getActiveRange();
    if (!range) return false;
    const startRow = range.getRow(),
      startColumn = range.getColumn();
    items = items.filter(
      (item) =>
        !this.isStatusColumn(startColumn + item.column, sheet.getSheetId()),
    );
    if (!items.length) {
      this.notify("状态列由系统维护，不能粘贴图片");
      return true;
    }
    let success = 0;
    const failures = [];
    const downloaded = new Array(items.length);
    const cache = new Map();
    let cursor = 0;
    this.notify(`正在读取 ${items.length} 张图片…`);
    const worker = async () => {
      while (cursor < items.length) {
        const i = cursor++,
          item = items[i];
        try {
          if (!cache.has(item.file || item.url))
            cache.set(
              item.file || item.url,
              (async () =>
                fileDataUrl(
                  item.file || (await loadClipboardImage(item.url)),
                ))(),
            );
          downloaded[i] = await cache.get(item.file || item.url);
          success++;
        } catch (error) {
          failures[i] = `第${i + 1}张：${error.message}`;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(6, items.length) }, worker),
    );
    if (this.disposed) return true;
    await this.batch(() => {
      const dirtyRows = new Set();
      for (const cell of cells)
        if (
          !cell.urls.length &&
          !this.isStatusColumn(startColumn + cell.column, sheet.getSheetId())
        ) {
          this.writeUserCell(
            this.canonicalRow(startRow + cell.row, sheet.getSheetId()),
            startColumn + cell.column,
            { v: cell.text, p: null },
            sheet.getSheetId(),
          );
          dirtyRows.add(startRow + cell.row);
        }
      const rows = new Set();
      downloaded.forEach((source, i) => {
        if (!source) return;
        this.writeUserCell(
          this.canonicalRow(startRow + items[i].row, sheet.getSheetId()),
          startColumn + items[i].column,
          imageCell(source),
          sheet.getSheetId(),
        );
        rows.add(startRow + items[i].row);
        dirtyRows.add(startRow + items[i].row);
      });
      for (const row of rows) sheet.setRowHeight(row, WORKFLOW_ROW_HEIGHTS[0]);
      this.markDirtyRows(dirtyRows, sheet.getSheetId());
    });
    this.onChange();
    const errors = failures.filter(Boolean);
    this.notify(
      `已粘贴 ${success} 张图片${errors.length ? "；" + errors.join("；") : ""}`,
    );
    return true;
  }
}
export function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
