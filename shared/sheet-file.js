import { detectColumns, imageCell } from "./sheet-data.js";

function text(value) {
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  if (value.richText) return value.richText.map((run) => run.text).join("");
  if (value.formula || value.sharedFormula) {
    if (/DISPIMG|(?:^|\.)IMAGE\s*\(/i.test(value.formula || ""))
      throw new Error(
        "文件包含专有单元格图片公式，请先将图片转换为普通嵌入图片再导入，避免丢失图片",
      );
    return text(value.result);
  }
  return String(value.text ?? value.error ?? "");
}
function sourceFor(media) {
  const extension = media.extension?.toLowerCase();
  if (!["png", "jpeg", "jpg", "webp", "gif"].includes(extension))
    throw new Error("导入图片仅支持 PNG、JPEG、WebP、GIF");
  const mime = extension === "jpg" ? "jpeg" : extension;
  if (media.base64)
    return media.base64.startsWith("data:")
      ? media.base64
      : `data:image/${mime};base64,${media.base64}`;
  if (!media.buffer)
    throw new Error("无法读取文件中的图片，请使用内嵌图片后重试");
  const bytes = new Uint8Array(media.buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:image/${mime};base64,${btoa(binary)}`;
}

export async function importSheetFile(file) {
  if (!/\.xlsx$/i.test(file.name))
    throw new Error("请选择 XLSX 文件；旧版 XLS 请先另存为 XLSX");
  if (file.size > 50 * 1024 * 1024)
    throw new Error("文件超过 50MB，请拆分后导入");
  const module = await import("exceljs"),
    ExcelJS = module.default || module;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error("无法读取 Excel 文件，请确认文件未加密且为有效 XLSX 格式");
  }
  // Select the first data sheet with known image-role headers, skipping help sheets.
  for (const worksheet of workbook.worksheets) {
    if (worksheet.rowCount > 10000 || worksheet.columnCount > 200)
      throw new Error("工作表过大，请拆分为不超过10000行、200列后导入");
    const sheet = {
      id: "file-import",
      name: `${file.name} · ${worksheet.name}`,
      rowCount: Math.max(1, worksheet.rowCount),
      columnCount: Math.max(1, worksheet.columnCount),
      cellData: {},
      rowData: {},
      columnData: {},
      mergeData: [],
    };
    worksheet.eachRow((row, r) => {
      row.eachCell((cell, c) => {
        if (cell.isMerged && cell.master.address !== cell.address) return;
        const value = text(cell.value);
        if (value) {
          sheet.cellData[r - 1] ||= {};
          sheet.cellData[r - 1][c - 1] = { v: value };
        }
      });
    });
    const mapping = detectColumns(sheet);
    if (mapping.headerRow < 0 || !mapping.roles.some((column) => column >= 0))
      continue;
    for (const range of worksheet.model.merges || []) {
      const [start, end = start] = range.split(":");
      const a = worksheet.getCell(start),
        b = worksheet.getCell(end);
      sheet.mergeData.push({
        startRow: Number(a.row) - 1,
        endRow: Number(b.row) - 1,
        startColumn: Number(a.col) - 1,
        endColumn: Number(b.col) - 1,
      });
    }
    const cache = new Map();
    for (const image of worksheet.getImages()) {
      if (!cache.has(image.imageId))
        cache.set(image.imageId, sourceFor(workbook.getImage(image.imageId)));
      const row = Math.floor(image.range.tl.row),
        column = Math.floor(image.range.tl.col);
      sheet.rowCount = Math.max(sheet.rowCount, row + 1);
      sheet.columnCount = Math.max(sheet.columnCount, column + 1);
      sheet.cellData[row] ||= {};
      const cell = imageCell(cache.get(image.imageId)),
        previous = sheet.cellData[row][column];
      if (previous?.p?.drawings)
        Object.assign(cell.p.drawings, previous.p.drawings);
      sheet.cellData[row][column] = cell;
    }
    return sheet;
  }
  throw new Error(
    "没有找到产品表头，请使用导出的模板，或确保存在尺寸图、卖点图等图片列",
  );
}
