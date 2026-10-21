import { ROLES, chosen, uid } from "../../shared/model.js";
import { productPhotos } from "../../shared/prompt-suite.js";
import { readClipboardCells, loadClipboardImage } from "./paste-images.js";
const HEADER = ["产品编号", "状态", "产品名称 / 资料", "内容", ...ROLES];
const ROW_TYPES = ["示例图", "提示词", "结果图"];
export const WORKFLOW_ROW_HEIGHTS = [160, 120, 160];

export function applyDefaultRowLayout(snapshot) {
  const sheet = snapshot?.sheets?.preview;
  if (!sheet) return;
  const mapping = detectColumns(sheet);
  if (mapping.headerRow < 0 || mapping.typeColumn < 0) return;
  const header = ((sheet.rowData ||= {})[mapping.headerRow] ||= {});
  if (header.custom?.workflowRowLayoutVersion === 1) return;
  for (const [key, cells] of Object.entries(sheet.cellData || {})) {
    const kind = ROW_TYPES.indexOf(cellText(cells[mapping.typeColumn]));
    if (kind < 0) continue;
    const data = (sheet.rowData[key] ||= {});
    if (data.h == null || data.h === (kind === 1 ? 94 : 132))
      data.h = WORKFLOW_ROW_HEIGHTS[kind];
  }
  header.custom = { ...header.custom, workflowRowLayoutVersion: 1 };
}

function productStatusCell(label, parsed = false) {
  const colors = {
    新建产品: ["#64748B", "#F1F5F9"],
    已同步: ["#15803D", "#F0FDF4"],
    未同步: ["#B45309", "#FFFBEB"],
  };
  const [text, background] = colors[label];
  return {
    v: label,
    s: {
      fs: 10,
      bl: 1,
      ht: 2,
      vt: 2,
      cl: { rgb: text },
      bg: { rgb: background },
    },
    custom: { workflowParsed: parsed },
  };
}

export function productStatusWrites(snapshot, products) {
  const sheet = snapshot?.sheets?.preview;
  if (!sheet) return [];
  const mapping = detectColumns(sheet);
  if (mapping.statusColumn < 0) return [];
  const byCode = new Map(products.map((product) => [product.code, product]));
  return parseSheet(sheet, mapping).flatMap((source) => {
    const row = source.sourceRows[0] - 1;
    const current = sheet.cellData[row]?.[mapping.statusColumn];
    const parsed = !!current?.custom?.workflowParsed;
    const product = byCode.get(source.code);
    const matches =
      product &&
      source.name === product.name &&
      source.facts === product.facts &&
      JSON.stringify(source.photos) ===
        JSON.stringify(productPhotos(product)) &&
      source.tasks.every((item) => {
        const task = product.tasks.find((task) => task.role === item.role);
        return (
          task &&
          item.prompt === task.prompt &&
          item.references[0] === task.references[0] &&
          (item.result || "") === (chosen(task)?.source || "")
        );
      });
    const dirty = source.sourceRows.some(
      (row) =>
        sheet.rowData?.[row - 1]?.custom?.workflowDirty ||
        sheet.rowData?.[row - 1]?.custom?.workflowSaveFailed,
    );
    const label = dirty
      ? "未同步"
      : parsed
        ? matches
          ? "已同步"
          : "未同步"
        : "新建产品";
    return current?.v === label && current?.custom?.workflowParsed === parsed
      ? []
      : [
          {
            row,
            column: mapping.statusColumn,
            cell: productStatusCell(label, parsed),
          },
        ];
  });
}

// Wrapped prompts should stay within the row height chosen by the user.
// Univer otherwise uses the computed `ah` even when an initial `h` exists.
export function preserveSheetRowHeights(snapshot) {
  for (const sheet of Object.values(snapshot?.sheets || {})) {
    sheet.rowData ||= {};
    for (let row = 0; row < sheet.rowCount; row++) {
      const data = (sheet.rowData[row] ||= {});
      data.h ??= sheet.defaultRowHeight;
      data.ia = 0;
      delete data.ah;
    }
  }
  return snapshot;
}

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
export function imageCell(
  source,
  width = 160,
  height = WORKFLOW_ROW_HEIGHTS[0],
) {
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
  const photoCount = Math.max(
    6,
    ...state.products.map((p) => productPhotos(p).length),
  );
  const headers = [
    ...HEADER,
    ...Array.from({ length: photoCount }, (_, i) => `实拍图${i + 1}`),
  ];
  const cells = {
      0: Object.fromEntries(headers.map((v, c) => [c, { v, s: "header" }])),
    },
    rows = { 0: { h: 38, custom: { workflowRowLayoutVersion: 1 } } },
    merges = [];
  state.products.forEach((p, index) => {
    const startRow = 1 + index * 3;
    for (const column of [0, 1, 2])
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
        1: kind === 0 ? productStatusCell("新建产品") : { v: "" },
        2: { v: kind === 0 ? `${p.name}\n${p.facts}` : "", s: "normal" },
        3: { v: ROW_TYPES[kind], s: "normal" },
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
      for (let i = 0; i < photoCount; i++)
        row[HEADER.length + i] =
          kind === 0 ? imageCell(productPhotos(p)[i]) : { v: "" };
      cells[r] = row;
      rows[r] = {
        h: WORKFLOW_ROW_HEIGHTS[kind],
        custom: { workflowProductId: p.id },
      };
    }
  });
  const sheet = (id, name, cellData, extra = {}) => ({
    id,
    name,
    rowCount: Math.max(500, state.products.length * 3 + 50),
    columnCount: Math.max(30, headers.length + 2),
    defaultColumnWidth: 160,
    defaultRowHeight: 36,
    cellData,
    ...extra,
  });
  return preserveSheetRowHeights({
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
        columnData: {
          0: { w: 110 },
          1: { w: 90 },
          2: { w: 210 },
          3: { w: 88 },
        },
        freeze: { xSplit: 4, ySplit: 1, startRow: 1, startColumn: 4 },
      }),
      inbox: sheet("inbox", "外部粘贴", {}, { defaultRowHeight: 100 }),
    },
  });
}
// Rearrange saved layouts without rebuilding user-edited cells or product rows.
export function ensureTrailingPhotos(snapshot, products) {
  const sheet = snapshot?.sheets?.preview;
  if (!sheet) return false;
  const mapping = detectColumns(sheet);
  if (mapping.headerRow < 0) return false;
  const photos = mapping.photoColumns || [];
  const count = Math.max(
    6,
    photos.length,
    ...products.map((p) => productPhotos(p).length),
  );
  const lastRole = Math.max(...mapping.roles);
  if (photos.length >= count && photos.every((c) => c > lastRole)) return false;
  const occupied = new Set(
    Object.entries(sheet.cellData || {}).flatMap(([, cells]) =>
      Object.entries(cells)
        .filter(
          ([, cell]) => cellText(cell) || cellImages(cell).length || cell.f,
        )
        .map(([c]) => Number(c)),
    ),
  );
  const last = Math.max(0, ...occupied);
  const rest = Array.from({ length: last + 1 }, (_, i) => i).filter(
    (c) => !photos.includes(c),
  );
  const order = [...rest, ...photos];
  const target = new Map(order.map((column, index) => [column, index]));
  const mapColumn = (c) =>
    target.get(Number(c)) ??
    order.length + count - photos.length + Number(c) - last - 1;
  for (const [row, cells] of Object.entries(sheet.cellData))
    sheet.cellData[row] = Object.fromEntries(
      Object.entries(cells).map(([c, cell]) => [mapColumn(c), cell]),
    );
  for (const data of Object.values(sheet.rowData || {}))
    if (data.custom?.workflowDrafts)
      data.custom.workflowDrafts = Object.fromEntries(
        Object.entries(data.custom.workflowDrafts).map(([column, draft]) => [
          mapColumn(column),
          draft,
        ]),
      );
  sheet.columnData = Object.fromEntries(
    Object.entries(sheet.columnData || {}).map(([c, data]) => [
      mapColumn(c),
      data,
    ]),
  );
  for (const merge of sheet.mergeData || []) {
    merge.startColumn = mapColumn(merge.startColumn);
    merge.endColumn = mapColumn(merge.endColumn);
  }
  const header = sheet.cellData[mapping.headerRow];
  for (let i = 0; i < count; i++)
    header[rest.length + i] = {
      ...header[rest.length + i],
      v: `实拍图${i + 1}`,
      s: header[rest.length + i]?.s || "header",
    };
  sheet.columnCount = Math.max(sheet.columnCount, rest.length + count + 2);
  const readCode = columnReader(sheet, mapColumn(mapping.codeColumn));
  const byCode = new Map(products.map((p) => [p.code, p]));
  for (const [row, cells] of Object.entries(sheet.cellData)) {
    if (cellText(cells[mapColumn(mapping.typeColumn)]) !== "示例图") continue;
    if (sheet.rowData?.[row]?.custom?.workflowDirty && photos.length > 1)
      continue;
    const product = byCode.get(cellText(readCode(Number(row))));
    if (!product) continue;
    const sources = productPhotos(product);
    for (let i = photos.length; i < count; i++)
      cells[rest.length + i] = imageCell(sources[i]);
  }
  return true;
}
export function cellText(cell) {
  return String(
    cell?.v ?? cell?.p?.body?.dataStream?.replace(/[\r\b\n]+$/g, "") ?? "",
  ).replace(/\r\n?/g, "\n");
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
// Resolve merged metadata with one index per column, rather than scanning all
// merged ranges for every product row and every backfilled cell.
function columnReader(sheet, column) {
  const ranges = (sheet.mergeData || [])
    .filter((range) => column >= range.startColumn && column <= range.endColumn)
    .sort((a, b) => a.startRow - b.startRow);
  return (row) => {
    let low = 0,
      high = ranges.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1,
        range = ranges[middle];
      if (row < range.startRow) high = middle - 1;
      else if (row > range.endRow) low = middle + 1;
      else return sheet.cellData?.[range.startRow]?.[range.startColumn];
    }
    return sheet.cellData?.[row]?.[column];
  };
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
// Rebuild only confirmed product blocks; retain all other rows and their metadata.
export function completeProductRows(snapshot, codes) {
  const source = snapshot?.sheets?.preview;
  if (!source) return { snapshot, changed: false, rowMap: new Map() };
  const mapping = detectColumns(source),
    selected = new Set(codes);
  if (mapping.typeColumn < 0)
    throw new Error("工作表缺少内容列，无法补齐产品三行结构");
  const metadataColumns = [
    mapping.codeColumn,
    mapping.statusColumn,
    mapping.nameColumn,
  ].filter((c) => c >= 0);
  const groups = parseSheet(source, mapping)
    .filter((p) => selected.has(p.code))
    .map((product) => {
      const rows = product.sourceRows.map((r) => r - 1),
        kinds = new Map();
      for (const row of rows) {
        const label = cellText(
          source.cellData[row]?.[mapping.typeColumn],
        ).trim();
        const kind = ROW_TYPES.includes(label)
          ? ROW_TYPES.indexOf(label)
          : Math.min(2, row - rows[0]);
        if (kinds.has(kind))
          throw new Error(
            `产品「${product.code}」存在重复${ROW_TYPES[kind]}行，请整理后再保存`,
          );
        kinds.set(kind, row);
      }
      for (const column of metadataColumns.filter(
        (c) => c !== mapping.statusColumn,
      )) {
        const values = rows
          .map((row) => sheetCell(source, row, column))
          .filter(
            (cell) => cellText(cell) || cellImages(cell).length || cell?.f,
          );
        if (
          values.some((cell) => cellImages(cell).length) ||
          new Set(
            values.map((cell) =>
              JSON.stringify([cellText(cell), cell.f || ""]),
            ),
          ).size > 1
        )
          throw new Error(
            `产品「${product.code}」的${column === mapping.codeColumn ? "编号" : "名称／资料"}列存在不同内容，合并前请先整理`,
          );
      }
      return { product, rows, kinds, start: rows[0] };
    });
  if (!groups.length) return { snapshot, changed: false, rowMap: new Map() };
  const sheet = structuredClone(source),
    cellData = {},
    rowData = {},
    rowMap = new Map();
  const starts = new Map(groups.map((g) => [g.start, g])),
    members = new Set(groups.flatMap((g) => g.rows));
  const last = Math.max(
    0,
    ...Object.keys(source.cellData || {}).map(Number),
    ...Object.keys(source.rowData || {}).map(Number),
    ...(source.mergeData || []).map((m) => m.endRow),
  );
  let nextRow = 0;
  for (let row = 0; row <= last; row++) {
    const group = starts.get(row);
    if (group) {
      group.target = nextRow;
      for (let kind = 0; kind < 3; kind++) {
        const previous = group.kinds.get(kind),
          target = nextRow++;
        if (previous !== undefined) rowMap.set(previous, target);
        cellData[target] = structuredClone(
          previous === undefined ? {} : source.cellData[previous] || {},
        );
        cellData[target][mapping.typeColumn] = {
          ...cellData[target][mapping.typeColumn],
          v: ROW_TYPES[kind],
          p: null,
        };
        rowData[target] = structuredClone(
          previous === undefined ? {} : source.rowData?.[previous] || {},
        );
        rowData[target].h ??= WORKFLOW_ROW_HEIGHTS[kind];
        rowData[target].ia = 0;
        delete rowData[target].ah;
        if (previous === undefined)
          rowData[target].custom = {
            workflowDraftVersion: 1,
            workflowDrafts: {},
            workflowDirty: false,
          };
        for (const column of metadataColumns) {
          const value = group.rows
            .map((r) => sheetCell(source, r, column))
            .find((cell) => cellText(cell) || cell?.f);
          cellData[target][column] =
            kind === 0
              ? structuredClone(value || { v: "" })
              : { ...cellData[target][column], v: "", p: null, f: null };
        }
      }
    } else if (!members.has(row)) {
      rowMap.set(row, nextRow);
      if (Object.hasOwn(source.cellData || {}, row))
        cellData[nextRow] = structuredClone(source.cellData[row]);
      if (Object.hasOwn(source.rowData || {}, row))
        rowData[nextRow] = structuredClone(source.rowData[row]);
      nextRow++;
    }
  }
  sheet.cellData = cellData;
  sheet.rowData = rowData;
  sheet.rowCount = Math.max(source.rowCount + nextRow - last - 1, nextRow);
  sheet.mergeData = (source.mergeData || [])
    .filter(
      (merge) =>
        !groups.some(
          (group) =>
            metadataColumns.some(
              (column) =>
                column >= merge.startColumn && column <= merge.endColumn,
            ) &&
            group.rows.some(
              (row) => row >= merge.startRow && row <= merge.endRow,
            ),
        ),
    )
    .map((merge) => ({
      ...merge,
      startRow: rowMap.get(merge.startRow),
      endRow: rowMap.get(merge.endRow),
    }));
  for (const group of groups)
    for (const column of metadataColumns)
      sheet.mergeData.push({
        startRow: group.target,
        endRow: group.target + 2,
        startColumn: column,
        endColumn: column,
      });
  sheet.mergeData.sort(
    (a, b) => a.startRow - b.startRow || a.startColumn - b.startColumn,
  );
  return {
    snapshot: { ...snapshot, sheets: { ...snapshot.sheets, preview: sheet } },
    changed: JSON.stringify(source) !== JSON.stringify(sheet),
    rowMap,
  };
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
          (c) =>
            labels[c].replace(/^\d+[.、_-]?/, "").replace(/[()（）]/g, "") ===
            role.replace(/\s/g, ""),
        ) ?? -1,
      ),
    );
    if (roles.some((c) => c >= 0)) {
      const lastRole = Math.max(...roles);
      const photoColumns = [
        ...new Set(
          Object.values(sheet.cellData || {}).flatMap((row) =>
            Object.keys(row),
          ),
        ),
      ]
        .map(Number)
        .filter(
          (c) =>
            /实拍/.test(labels[c]) ||
            (c > lastRole &&
              !labels[c] &&
              Object.values(sheet.cellData || {}).some(
                (row) => cellImages(row[c]).length,
              )),
        )
        .sort((a, b) => a - b);
      return {
        headerRow: Number(r),
        codeColumn: Number(
          Object.keys(labels).find((c) =>
            /^(产品编号|编号|SKU)$/i.test(labels[c]),
          ) ??
            Object.keys(labels).find((c) => /^(序列|序号)$/.test(labels[c])) ??
            0,
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
        photoColumn: photoColumns[0] ?? -1,
        photoColumns,
        statusColumn: Number(
          Object.keys(labels).find((c) => labels[c] === "状态") ?? -1,
        ),
        roles,
      };
    }
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
    photoColumns: [],
    statusColumn: -1,
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
  const readCode = columnReader(sheet, mapping.codeColumn);
  const readName = columnReader(sheet, mapping.nameColumn);
  let lastCode = "",
    group = 0;
  const rows = Object.entries(sheet.cellData || {})
    .filter(([r]) => Number(r) > mapping.headerRow)
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  for (const [rowKey, cells] of rows) {
    const row = Number(rowKey),
      type = cellText(cells[mapping.typeColumn]).trim();
    const explicit = cellText(readCode(row)).trim();
    const hasData = [...mapping.roles, ...(mapping.photoColumns || [])].some(
      (c) => c >= 0 && (cellText(cells[c]) || cellImages(cells[c]).length),
    );
    const three =
      layout === "three" || (layout === "auto" && mapping.typeColumn >= 0);
    let kind = three
      ? ROW_TYPES.indexOf(type) >= 0
        ? ROW_TYPES.indexOf(type)
        : (row - mapping.headerRow - 1) % 3
      : 0;
    if (
      !hasData &&
      !explicit &&
      !(three && lastCode && kind > 0 && (type || layout === "three"))
    )
      continue;
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
        photos: [],
        present: { metadata: mapping.nameColumn >= 0, photo: false },
        tasks: ROLES.map((role) => ({
          role,
          references: [],
          prompt: "",
          result: "",
          present: { references: false, prompt: false, result: false },
        })),
        sourceRows: [],
      };
      result.set(lastCode, product);
    }
    if (
      !hasData &&
      !explicit &&
      !Object.keys(sheet.rowData?.[row]?.custom?.workflowDrafts || {}).length &&
      product.sourceRows.some(
        (previous) =>
          cellText(
            sheet.cellData[previous - 1]?.[mapping.typeColumn],
          ).trim() === type,
      )
    )
      continue;
    const metadata = cellText(readName(row)).trim();
    if (metadata) {
      const [name, ...rest] = metadata.split(/\r?\n/);
      product.name = name;
      product.facts = rest.join("\n");
    }
    const photoColumns =
      mapping.photoColumns ??
      (mapping.photoColumn >= 0 ? [mapping.photoColumn] : []);
    if (kind === 0 && photoColumns.length) {
      const photos = photoColumns.flatMap((column) =>
        cellImages(sheetCell(sheet, row, column)),
      );
      product.photos = [...new Set([...product.photos, ...photos])];
      product.photo = product.photos[0] || "";
      product.present.photo = true;
    }
    product.sourceRows.push(row + 1);
    mapping.roles.forEach((column, i) => {
      if (column < 0) return;
      const images = cellImages(cells[column]),
        text = cellText(cells[column]);
      if (kind === 0) {
        product.tasks[i].references = images;
        product.tasks[i].present.references = true;
      }
      if (kind === 1) {
        product.tasks[i].prompt = text;
        product.tasks[i].present.prompt = true;
      }
      if (kind === 2) {
        product.tasks[i].result = images[0] || "";
        product.tasks[i].present.result = true;
      }
      if (!three && text && !images.length) product.tasks[i].prompt = text;
      if (!three) product.tasks[i].present.prompt = true;
    });
  }
  return [...result.values()];
}

export function validateSheetParse(sheet, mapping, layout, candidates) {
  const issues = [];
  if (
    !Number.isInteger(mapping.headerRow) ||
    mapping.headerRow < -1 ||
    mapping.headerRow >= sheet.rowCount
  )
    issues.push("表头所在行超出表格范围，请在高级配置中检查。");
  const columns = [
    mapping.codeColumn,
    mapping.nameColumn,
    mapping.typeColumn,
    ...(mapping.photoColumns ?? [mapping.photoColumn]),
    mapping.statusColumn,
    ...mapping.roles,
  ].filter((column) => column >= 0);
  if (
    columns.some(
      (column) => !Number.isInteger(column) || column >= sheet.columnCount,
    )
  )
    issues.push("列对应关系超出表格范围，请在高级配置中检查。");
  if (new Set(columns).size !== columns.length)
    issues.push("多个字段使用了同一列，请在高级配置中调整列对应关系。");
  const three =
    layout === "three" || (layout === "auto" && mapping.typeColumn >= 0);
  const seen = new Map();
  for (const [key, cells] of Object.entries(sheet.cellData || {})) {
    const row = Number(key);
    if (row <= mapping.headerRow) continue;
    const type = cellText(cells[mapping.typeColumn]).trim();
    const start =
      !three ||
      (type ? type === ROW_TYPES[0] : (row - mapping.headerRow - 1) % 3 === 0);
    if (!start) continue;
    const code = cellText(sheetCell(sheet, row, mapping.codeColumn)).trim();
    if (!code) continue;
    if (seen.has(code))
      issues.push(
        `产品编号「${code}」在第 ${seen.get(code)} 行和第 ${row + 1} 行重复，请先修改编号。`,
      );
    else seen.set(code, row + 1);
  }
  if (sheet.id === "preview") {
    for (const product of candidates) {
      if (
        !product.sourceRows.some((row) =>
          cellText(sheetCell(sheet, row - 1, mapping.codeColumn)).trim(),
        )
      )
        issues.push(
          `第 ${product.sourceRows[0]} 行缺少产品编号，请填写后再保存。`,
        );
      if (product.present.metadata && !product.name)
        issues.push(`产品「${product.code}」缺少名称，请填写后再保存。`);
    }
  }
  return issues;
}
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
    ensureTrailingPhotos(state.sheetSnapshot, state.products);
    applyDefaultRowLayout(state.sheetSnapshot);
    preserveSheetRowHeights(state.sheetSnapshot);
    if (!state.sheetMetadataMergeVersion) {
      mergeProductMetadata(state.sheetSnapshot);
      state.sheetMetadataMergeVersion = 1;
    }
    this.onChange = onChange;
    this.notify = notify;
    this.api = null;
    this.workbook = null;
    this.knownProducts = new Set(state.products.map((p) => p.id));
    this.onConflicts = onConflicts;
    this.conflicts = new Map();
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
      this.api.Event.SheetValueChanged,
      () => {
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
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.captureTimer);
    this.valueSubscription?.dispose();
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
    for (const product of this.state.products) {
      if (!this.knownProducts.has(product.id)) {
        this.knownProducts.add(product.id);
        this.appendProduct(product);
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
      for (const { row, column, cell } of productStatusWrites(
        source,
        this.state.products,
      )) {
        snapshot.sheets.preview.cellData[row][column] = cell;
        const local = this.pageRows ? this.pageRows.get(row) : row;
        if (local !== undefined && this.workbook?.getSheetBySheetId)
          this.systemMutation(
            "sheet.mutation.set-range-values",
            {
              subUnitId: "preview",
              cellValue: { [local]: { [column]: cell } },
            },
            () =>
              this.workbook
                .getSheetBySheetId("preview")
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
    clearTimeout(this.captureTimer);
    const workbook = this.workbook;
    this.workbook = null;
    if (workbook) this.api.disposeUnit(workbook.getId());
    this.state.sheetSnapshot = result.snapshot;
    this.pageRows = null;
    this.batchLocations = null;
    this.conflicts = new Map(
      [...this.conflicts].map(([, conflict]) => {
        const row = result.rowMap.get(conflict.row) ?? conflict.row;
        const message = conflict.message.replace(
          ` · ${this.cellAddress(conflict.row, conflict.column)}：`,
          ` · ${this.cellAddress(row, conflict.column)}：`,
        );
        return [`${row}:${conflict.column}`, { ...conflict, row, message }];
      }),
    );
    if (workbook) this.workbook = this.api.createWorkbook(this.project());
    this.publishConflicts();
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
