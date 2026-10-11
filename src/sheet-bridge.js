import { ROLES, chosen, uid } from "./model.js";
import {
  readClipboardImages,
  readClipboardCells,
  loadClipboardImage,
} from "./paste-images.js";
const HEADER = ["产品编号", "产品名称 / 资料", "内容", "实拍图", ...ROLES];
const ROW_TYPES = ["示例图", "提示词", "结果图"];
function sourceDimensions(source) {
  try {
    const raw = source.split(",")[1];
    if (!raw) return null;
    const bytes = Uint8Array.from(
      atob(raw.slice(0, Math.min(raw.length, 20000))),
      (c) => c.charCodeAt(0),
    );
    const view = new DataView(bytes.buffer);
    if (bytes[0] === 137 && bytes[1] === 80)
      return [view.getUint32(16), view.getUint32(20)];
    if (bytes[0] === 255 && bytes[1] === 216) {
      for (let offset = 2; offset < bytes.length - 9; ) {
        if (bytes[offset] !== 255) {
          offset++;
          continue;
        }
        const marker = bytes[offset + 1],
          length = view.getUint16(offset + 2);
        if (
          [
            192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
          ].includes(marker)
        )
          return [view.getUint16(offset + 7), view.getUint16(offset + 5)];
        offset += 2 + length;
      }
    }
    if (String.fromCharCode(...bytes.slice(12, 16)) === "VP8X")
      return [
        1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      ];
  } catch {}
  return [4, 3];
}
export function imageCell(source, width = 160, height = 132) {
  if (!source) return { v: "", p: null };
  const id = uid(),
    drawId = uid();
  const [naturalWidth, naturalHeight] = sourceDimensions(source) || [4, 3];
  const scale = Math.min(
    (width - 6) / naturalWidth,
    (height - 6) / naturalHeight,
  );
  const w = naturalWidth * scale,
    h = naturalHeight * scale;
  return {
    v: "",
    t: 1,
    p: {
      id,
      locale: "zhCN",
      body: {
        dataStream: "\r\b\r\n",
        textRuns: [],
        paragraphs: [{ startIndex: 0 }, { startIndex: 2 }],
        sectionBreaks: [{ startIndex: 3 }],
        customBlocks: [{ startIndex: 1, blockId: drawId }],
      },
      drawings: {
        [drawId]: {
          unitId: id,
          subUnitId: id,
          drawingId: drawId,
          drawingType: 0,
          imageSourceType: "BASE64",
          source,
          transform: { left: 0, top: 0, width: w, height: h },
          docTransform: {
            size: { width: w, height: h },
            positionH: { relativeFrom: 0, posOffset: 0 },
            positionV: { relativeFrom: 1, posOffset: 0 },
            angle: 0,
          },
          layoutType: 0,
          wrapText: 0,
          behindDoc: 0,
          distB: 0,
          distL: 0,
          distR: 0,
          distT: 0,
        },
      },
      drawingsOrder: [drawId],
      documentStyle: {
        pageSize: { width: Infinity, height: Infinity },
        marginTop: 0,
        marginBottom: 2,
        marginLeft: 2,
        marginRight: 2,
        renderConfig: {
          horizontalAlign: 2,
          verticalAlign: 2,
          centerAngle: 0,
          vertexAngle: 0,
          wrapStrategy: 0,
        },
      },
    },
  };
}
export function workflowSnapshot(state) {
  const styles = {
    header: {
      bg: { rgb: "#545DD6" },
      cl: { rgb: "#FFFFFF" },
      bl: 1,
      fs: 11,
      vt: 2,
      ht: 2,
    },
    normal: { fs: 11, cl: { rgb: "#35415A" }, vt: 2, tb: 3 },
    prompt: {
      fs: 10,
      cl: { rgb: "#596079" },
      bg: { rgb: "#F4F5FC" },
      vt: 1,
      tb: 3,
    },
  };
  const cells = {
      0: Object.fromEntries(HEADER.map((v, c) => [c, { v, s: "header" }])),
    },
    rows = { 0: { h: 38 } },
    merges = [];
  state.products.forEach((p, index) => {
    const startRow = 1 + index * 3;
    for (const column of [0, 1])
      merges.push({
        startRow,
        endRow: startRow + 2,
        startColumn: column,
        endColumn: column,
      });
    for (let kind = 0; kind < 3; kind++) {
      const r = 1 + index * 3 + kind;
      const row = {
        0: { v: kind === 0 ? p.code : "", s: "normal" },
        1: { v: kind === 0 ? `${p.name}\n${p.facts}` : "", s: "normal" },
        2: { v: ROW_TYPES[kind], s: "normal" },
        3: kind === 0 ? imageCell(p.photo) : { v: "" },
      };
      p.tasks.forEach(
        (task, t) =>
          (row[t + 4] =
            kind === 0
              ? imageCell(task.references[0])
              : kind === 1
                ? { v: task.prompt, s: "prompt" }
                : imageCell(chosen(task)?.source)),
      );
      cells[r] = row;
      rows[r] = { h: kind === 1 ? 94 : 132 };
    }
  });
  const sheet = (id, name, cellData, extra = {}) => ({
    id,
    name,
    rowCount: Math.max(500, state.products.length * 3 + 50),
    columnCount: 30,
    defaultColumnWidth: 160,
    defaultRowHeight: 36,
    cellData,
    ...extra,
  });
  return {
    id: "workflow",
    name: "图序 · 生图工作流",
    locale: "zhCN",
    appVersion: "1.0.4",
    styles,
    sheetOrder: ["preview", "inbox"],
    sheets: {
      preview: sheet("preview", "工作流预览", cells, {
        mergeData: merges,
        rowData: rows,
        columnData: { 0: { w: 110 }, 1: { w: 210 }, 2: { w: 88 } },
        freeze: { xSplit: 3, ySplit: 1, startRow: 1, startColumn: 3 },
      }),
      inbox: sheet("inbox", "外部粘贴", {}, { defaultRowHeight: 100 }),
    },
  };
}
export function cellText(cell) {
  return String(
    cell?.v ?? cell?.p?.body?.dataStream?.replace(/[\r\b\n]+$/g, "") ?? "",
  );
}
export function cellImages(cell) {
  return Object.values(cell?.p?.drawings || {})
    .map((d) => d.source)
    .filter(Boolean);
}
export function sheetCell(sheet, row, column) {
  const merge = sheet.mergeData?.find(
    (range) =>
      row >= range.startRow &&
      row <= range.endRow &&
      column >= range.startColumn &&
      column <= range.endColumn,
  );
  return sheet.cellData?.[merge ? merge.startRow : row]?.[
    merge ? merge.startColumn : column
  ];
}
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
export function detectColumns(sheet) {
  for (const [r, cells] of Object.entries(sheet.cellData || {}).slice(0, 20)) {
    const labels = Object.fromEntries(
      Object.entries(cells).map(([c, v]) => [
        c,
        cellText(v).replace(/\s/g, ""),
      ]),
    );
    const roles = ROLES.map((role) =>
      Number(
        Object.keys(labels).find(
          (c) => labels[c] === role.replace(/\s/g, ""),
        ) ?? -1,
      ),
    );
    if (roles.some((c) => c >= 0))
      return {
        headerRow: Number(r),
        codeColumn: Number(
          Object.keys(labels).find((c) =>
            /^(产品编号|编号|序列|SKU)$/i.test(labels[c]),
          ) ?? 0,
        ),
        nameColumn: Number(
          Object.keys(labels).find((c) =>
            /产品名称|产品信息|产品资料|产品名称\/资料/.test(labels[c]),
          ) ?? 1,
        ),
        typeColumn: Number(
          Object.keys(labels).find((c) =>
            /^(内容|行类型|类型)$/.test(labels[c]),
          ) ?? -1,
        ),
        photoColumn: Number(
          Object.keys(labels).find((c) => /实拍/.test(labels[c])) ?? -1,
        ),
        roles,
      };
  }
  const data = Object.values(sheet.cellData || {}).slice(0, 12);
  const imageColumns = [
    ...new Set(
      data.flatMap((row) =>
        Object.keys(row)
          .filter((c) => cellImages(row[c]).length)
          .map(Number),
      ),
    ),
  ].sort((a, b) => a - b);
  const textColumns = [
    ...new Set(
      data.flatMap((row) =>
        Object.keys(row)
          .filter((c) => cellText(row[c]) && !cellImages(row[c]).length)
          .map(Number),
      ),
    ),
  ].sort((a, b) => a - b);
  return {
    headerRow: -1,
    codeColumn: textColumns[0] ?? -1,
    nameColumn: textColumns[1] ?? -1,
    typeColumn: -1,
    photoColumn: -1,
    roles: ROLES.map((_, i) =>
      imageColumns.length ? (imageColumns[i] ?? -1) : i + 2,
    ),
  };
}
export function parseSheet(
  sheet,
  mapping,
  layout = "auto",
  fallbackCode = "导入",
) {
  const result = new Map();
  let lastCode = "",
    group = 0;
  const rows = Object.entries(sheet.cellData || {})
    .filter(([r]) => Number(r) > mapping.headerRow)
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  for (const [rowKey, cells] of rows) {
    const row = Number(rowKey),
      type = cellText(cells[mapping.typeColumn]);
    const explicit = cellText(sheetCell(sheet, row, mapping.codeColumn)).trim();
    const hasData = mapping.roles.some(
      (c) => c >= 0 && (cellText(cells[c]) || cellImages(cells[c]).length),
    );
    if (!hasData && !explicit) continue;
    const three =
      layout === "three" || (layout === "auto" && mapping.typeColumn >= 0);
    let kind = three
      ? ROW_TYPES.indexOf(type) >= 0
        ? ROW_TYPES.indexOf(type)
        : (row - mapping.headerRow - 1) % 3
      : 0;
    if (explicit) lastCode = explicit;
    if (!lastCode || (!explicit && (!three || kind === 0)))
      lastCode = `${fallbackCode}-${++group}`;
    let product = result.get(lastCode);
    if (!product) {
      product = {
        code: lastCode,
        name: "",
        facts: "",
        photo: "",
        tasks: ROLES.map((role) => ({
          role,
          references: [],
          prompt: "",
          result: "",
        })),
        sourceRows: [],
      };
      result.set(lastCode, product);
    }
    const metadata = cellText(sheetCell(sheet, row, mapping.nameColumn)).trim();
    if (metadata) {
      const [name, ...rest] = metadata.split("\n");
      product.name = name;
      product.facts = rest.join("\n");
    }
    product.photo = cellImages(cells[mapping.photoColumn])[0] || product.photo;
    product.sourceRows.push(row + 1);
    mapping.roles.forEach((column, i) => {
      if (column < 0) return;
      const images = cellImages(cells[column]),
        text = cellText(cells[column]);
      if (kind === 0 && images.length) product.tasks[i].references = images;
      if (kind === 1 && text) product.tasks[i].prompt = text;
      if (kind === 2 && images.length) product.tasks[i].result = images[0];
      if (!three && text && !images.length) product.tasks[i].prompt = text;
    });
  }
  return [...result.values()];
}
export class SheetBridge {
  constructor(state, onChange, notify) {
    this.state = state;
    if (!state.sheetMetadataMergeVersion) {
      mergeProductMetadata(state.sheetSnapshot);
      state.sheetMetadataMergeVersion = 1;
    }
    this.onChange = onChange;
    this.notify = notify;
    this.api = null;
    this.workbook = null;
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
    this.workbook = univerAPI.createWorkbook(
      this.state.sheetSnapshot || workflowSnapshot(this.state),
    );
    if (import.meta.env.MODE === "demo") window.demoAPI = univerAPI;
    this.valueSubscription = this.api.addEvent(
      this.api.Event.SheetValueChanged,
      () => {
        clearTimeout(this.captureTimer);
        this.captureTimer = setTimeout(() => {
          this.capture();
          this.onChange();
        }, 400);
      },
    );
    this.capture();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.captureTimer);
    this.valueSubscription?.dispose();
    this.api?.dispose();
    this.univer?.dispose();
    this.workbook = null;
    this.api = null;
  }
  capture() {
    if (this.workbook) this.state.sheetSnapshot = this.workbook.save();
    return this.state.sheetSnapshot;
  }
  snapshot() {
    return this.capture() || workflowSnapshot(this.state);
  }
  locate(product, task, kind) {
    const snapshot = this.snapshot(),
      sheet = snapshot.sheets.preview;
    if (!sheet) throw new Error("工作流预览表已被删除，请恢复表格后回填");
    const mapping = detectColumns(sheet),
      column = mapping.roles[ROLES.indexOf(task.role)];
    const type =
      kind === "prompt" ? "提示词" : kind === "reference" ? "示例图" : "结果图";
    const row = Object.keys(sheet.cellData).find(
      (r) =>
        cellText(sheetCell(sheet, Number(r), mapping.codeColumn)) ===
          product.code &&
        cellText(sheet.cellData[r][mapping.typeColumn]) === type,
    );
    if (row === undefined || column < 0)
      throw new Error(
        `${product.code} ${task.role} 的回填位置缺失，请恢复对应编号和内容标签`,
      );
    return { row: Number(row), column };
  }
  async sync(product, task, kind) {
    // A snapshot is maintained even before the user opens the spreadsheet view.
    if (!this.state.sheetSnapshot && !this.workbook) return;
    const { row, column } = this.locate(product, task, kind);
    const cell =
      kind === "prompt"
        ? { v: task.prompt, p: null, s: "prompt" }
        : imageCell(
            kind === "reference" ? task.references[0] : chosen(task)?.source,
          );
    if (this.workbook)
      this.workbook
        .getSheetBySheetId("preview")
        .getRange(row, column, 1, 1)
        .setValue(cell);
    else this.state.sheetSnapshot.sheets.preview.cellData[row][column] = cell;
    this.capture();
  }
  async reconcile() {
    const errors = new Set();
    if (!this.state.sheetSnapshot) return [];
    for (const product of this.state.products)
      for (const task of product.tasks) {
        try {
          for (const kind of ["reference", "prompt", "result"])
            await this.sync(product, task, kind);
        } catch (error) {
          errors.add(error.message);
        }
      }
    return [...errors];
  }
  appendProduct(product) {
    if (!this.state.sheetSnapshot && !this.workbook) return;
    const generated = workflowSnapshot({ ...this.state, products: [product] })
      .sheets.preview;
    const snapshot = this.snapshot(),
      sheet = snapshot.sheets.preview,
      mapping = detectColumns(sheet);
    const targetColumns = [
      mapping.codeColumn,
      mapping.nameColumn,
      mapping.typeColumn,
      mapping.photoColumn,
      ...mapping.roles,
    ];
    const last = Math.max(0, ...Object.keys(sheet.cellData).map(Number));
    for (let i = 1; i <= 3; i++) {
      const row = last + i;
      if (this.workbook) {
        const target = this.workbook.getSheetBySheetId("preview");
        if (row >= sheet.rowCount) target.insertRows(sheet.rowCount, 100);
        for (const [c, to] of targetColumns.entries())
          if (to >= 0)
            target.getRange(row, to, 1, 1).setValue(generated.cellData[i][c]);
        target.setRowHeight(row, generated.rowData[i].h);
      } else {
        sheet.cellData[row] = Object.fromEntries(
          targetColumns
            .map((to, c) => [to, generated.cellData[i][c]])
            .filter(([to]) => to >= 0),
        );
        sheet.rowData[row] = generated.rowData[i];
        sheet.rowCount = Math.max(sheet.rowCount, row + 1);
      }
    }
    for (const column of [mapping.codeColumn, mapping.nameColumn]) {
      if (column < 0) continue;
      if (this.workbook)
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
    this.capture();
  }
  async paste(clipboard) {
    if (!this.workbook) return false;
    const items = readClipboardImages(
      clipboard.getData("text/html"),
      clipboard.getData("text/plain"),
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
    // Keep the text in a mixed table as well as its pictures.
    for (const cell of readClipboardCells(
      clipboard.getData("text/html"),
      clipboard.getData("text/plain"),
    )) {
      if (!cell.urls.length)
        sheet
          .getRange(startRow + cell.row, startColumn + cell.column, 1, 1)
          .setValue(cell.text);
    }
    let success = 0;
    const failures = [];
    for (const [i, item] of items.entries()) {
      try {
        const file = item.file || (await loadClipboardImage(item.url));
        const source = await fileDataUrl(file);
        sheet
          .getRange(startRow + item.row, startColumn + item.column, 1, 1)
          .setValue(imageCell(source));
        sheet.setRowHeight(startRow + item.row, 132);
        success++;
      } catch (error) {
        failures.push(`第${i + 1}张：${error.message}`);
      }
    }
    this.capture();
    this.onChange();
    this.notify(
      `已粘贴 ${success} 张图片${failures.length ? "；" + failures.join("；") : ""}`,
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
