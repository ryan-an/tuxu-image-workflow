import { ROLES, chosen, uid } from "./model.js";
import { productPhotos } from "./prompt-suite.js";
const HEADER = ["产品编号", "状态", "产品名称 / 资料", "内容", ...ROLES];
export function removeProductRows(snapshot, product) {
  if (!snapshot) return snapshot;
  const result = structuredClone(snapshot);
  const sheet = result.sheets?.preview;
  if (!sheet) return result;
  const rows = new Set();
  for (const [row, data] of Object.entries(sheet.rowData || {}))
    if (data.custom?.workflowProductId === product.id) rows.add(Number(row));
  for (const source of parseSheet(sheet, detectColumns(sheet)))
    if (source.code === product.code)
      for (const row of source.sourceRows) rows.add(row - 1);
  for (const row of rows) {
    delete sheet.cellData[row];
    if (sheet.rowData) delete sheet.rowData[row];
  }
  sheet.mergeData = (sheet.mergeData || []).filter(
    (merge) =>
      ![...rows].some((row) => row >= merge.startRow && row <= merge.endRow),
  );
  return result;
}
export const ROW_TYPES = ["示例图", "提示词", "结果图"];
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

export function productStatusCell(label, parsed = false) {
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

export function productStatusWrites(snapshot, products, sheetId = "preview") {
  const sheet = snapshot?.sheets?.[sheetId];
  if (!sheet) return [];
  const mapping = detectColumns(sheet);
  if (mapping.statusColumn < 0) return [];
  const byCode = new Map(products.map((product) => [product.code, product]));
  return parseSheet(sheet, mapping).flatMap((source) => {
    const row = source.sourceRows[0] - 1;
    const current = sheet.cellData[row]?.[mapping.statusColumn];
    const product = byCode.get(source.code);
    const parsed = !!product && !!current?.custom?.workflowParsed;
    // Background generation does not make untouched table cells dirty.
    const dirty = source.sourceRows.some(
      (row) =>
        sheet.rowData?.[row - 1]?.custom?.workflowDirty ||
        sheet.rowData?.[row - 1]?.custom?.workflowSaveFailed,
    );
    const label = !product
      ? "新建产品"
      : dirty
        ? "未同步"
        : parsed
          ? "已同步"
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
export function workflowSnapshot(state, { compact = false } = {}) {
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
    rowCount: compact
      ? state.products.length * 3 + 1
      : Math.max(500, state.products.length * 3 + 50),
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
export function columnReader(sheet, column) {
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
    if (
      /^(产品编号|编号)$/.test(cellText(cells[mapping.codeColumn]).trim()) &&
      mapping.roles.some(
        (column, i) =>
          cellText(cells[column]).replace(/\s/g, "") ===
          ROLES[i].replace(/\s/g, ""),
      )
    )
      continue;
    const hasData =
      !!cellText(cells[mapping.nameColumn]) ||
      [...mapping.roles, ...(mapping.photoColumns || [])].some(
        (c) => c >= 0 && (cellText(cells[c]) || cellImages(cells[c]).length),
      );
    const three =
      layout === "three" || (layout === "auto" && mapping.typeColumn >= 0);
    let kind = three
      ? ROW_TYPES.indexOf(type) >= 0
        ? ROW_TYPES.indexOf(type)
        : (row - mapping.headerRow - 1) % 3
      : 0;
    // A newly pasted product is a reference row, regardless of its row number.
    if (
      layout === "auto" &&
      !type &&
      cellText(cells[mapping.codeColumn]).trim()
    )
      kind = 0;
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
      (type
        ? type === ROW_TYPES[0]
        : (layout === "auto" && !!cellText(cells[mapping.codeColumn]).trim()) ||
          (row - mapping.headerRow - 1) % 3 === 0);
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
