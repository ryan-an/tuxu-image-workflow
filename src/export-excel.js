function color(value) {
  const rgb = typeof value === "string" ? value : value?.rgb;
  if (!rgb || !/^#?[0-9a-f]{6}$/i.test(rgb)) return undefined;
  return "FF" + rgb.replace("#", "").toUpperCase();
}
function plainText(cell) {
  return cell.v ?? cell.p?.body?.dataStream?.replace(/[\r\n\b]+$/g, "") ?? "";
}
async function picture(source) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d").drawImage(image, 0, 0);
  return {
    base64: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
  };
}
export async function exportExcel(snapshot) {
  const module = await import("exceljs");
  const ExcelJS = module.default || module;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "图序";
  workbook.calcProperties.fullCalcOnLoad = true;
  let imageCount = 0;
  for (const sheetId of snapshot.sheetOrder) {
    const source = snapshot.sheets[sheetId];
    if (!source) continue;
    const sheet = workbook.addWorksheet(source.name);
    const columnWidth = (column) =>
      source.columnData?.[column]?.w ?? source.defaultColumnWidth ?? 125;
    const rowHeight = (row) =>
      source.rowData?.[row]?.h ?? source.defaultRowHeight ?? 36;
    sheet.properties.defaultRowHeight = (source.defaultRowHeight || 36) * 0.75;
    for (let c = 0; c < source.columnCount; c++) {
      sheet.getColumn(c + 1).width = Math.max(1, (columnWidth(c) - 5) / 7);
      sheet.getColumn(c + 1).hidden = !!source.columnData?.[c]?.hd;
    }
    for (const [row, data] of Object.entries(source.rowData || {})) {
      sheet.getRow(Number(row) + 1).height = rowHeight(row) * 0.75;
      sheet.getRow(Number(row) + 1).hidden = !!data.hd;
    }
    const frozen = source.freeze;
    if (frozen && (frozen.xSplit || frozen.ySplit))
      sheet.views = [
        {
          state: "frozen",
          xSplit: frozen.xSplit || 0,
          ySplit: frozen.ySplit || 0,
        },
      ];
    for (const [rowKey, cells] of Object.entries(source.cellData || {})) {
      const row = Number(rowKey);
      for (const [colKey, data] of Object.entries(cells)) {
        const column = Number(colKey),
          cell = sheet.getCell(row + 1, column + 1);
        const value = plainText(data);
        cell.value = data.f
          ? {
              formula: data.f.replace(/^=/, ""),
              ...(value !== "" ? { result: value } : {}),
            }
          : value;
        const style =
          typeof data.s === "string" ? snapshot.styles?.[data.s] : data.s;
        if (style) {
          cell.font = {
            name: style.ff || "Microsoft YaHei",
            size: style.fs || 11,
            bold: !!style.bl,
            italic: !!style.it,
            ...(color(style.cl) ? { color: { argb: color(style.cl) } } : {}),
          };
          if (color(style.bg))
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: color(style.bg) },
            };
          cell.alignment = {
            vertical: ["top", "top", "middle", "bottom"][style.vt] || "middle",
            horizontal: ["left", "left", "center", "right"][style.ht] || "left",
            wrapText: true,
          };
          if (style.n?.pattern) cell.numFmt = style.n.pattern;
        }
        const drawings = data.p?.drawings || {};
        for (const drawingId of data.p?.drawingsOrder ||
          Object.keys(drawings)) {
          const drawing = drawings[drawingId];
          if (!drawing?.source) continue;
          const image = await picture(drawing.source);
          const id = workbook.addImage({
            base64: image.base64,
            extension: "png",
          });
          const cw = columnWidth(column),
            rh = rowHeight(row);
          const scale = Math.min(
            Math.max(1, cw - 4) / image.width,
            Math.max(1, rh - 4) / image.height,
          );
          const width = image.width * scale,
            height = image.height * scale;
          const left = (cw - width) / 2,
            top = (rh - height) / 2;
          sheet.addImage(id, {
            tl: { col: column + left / cw, row: row + top / rh },
            br: {
              col: column + (left + width) / cw,
              row: row + (top + height) / rh,
            },
            editAs: "twoCell",
          });
          imageCount++;
        }
      }
    }
    for (const merge of source.mergeData || [])
      sheet.mergeCells(
        merge.startRow + 1,
        merge.startColumn + 1,
        merge.endRow + 1,
        merge.endColumn + 1,
      );
  }
  return { buffer: await workbook.xlsx.writeBuffer(), imageCount };
}
