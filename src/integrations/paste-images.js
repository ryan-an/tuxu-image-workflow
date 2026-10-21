// Both text and images use the same grid, including merged and empty cells.
export function readClipboardCells(html, text) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const table = doc.querySelector("table");
  const imageUrls = (node) => [
    ...new Set(
      [...node.querySelectorAll("img")]
        .map((img) => img.getAttribute("src"))
        .concat(
          [...node.querySelectorAll("a[href]")].map((a) =>
            a.getAttribute("href"),
          ),
        )
        .filter(isImageUrl),
    ),
  ];
  if (table) {
    const result = [];
    const occupied = new Set();
    for (const [row, tr] of [...table.rows].entries()) {
      let column = 0;
      for (const cell of tr.cells) {
        while (occupied.has(`${row}:${column}`)) column++;
        const urls = imageUrls(cell);
        const width = Math.max(cell.colSpan || 1, urls.length);
        const height =
          cell.rowSpan === 0 ? table.rows.length - row : cell.rowSpan || 1;
        result.push({ row, column, text: cell.textContent.trim(), urls });
        for (let r = row; r < Math.min(row + height, table.rows.length); r++)
          for (let c = column; c < column + width; c++)
            occupied.add(`${r}:${c}`);
        column += width;
      }
    }
    return result;
  }
  const urls = imageUrls(doc);
  if (urls.length)
    return urls.map((url, column) => ({
      row: 0,
      column,
      text: "",
      urls: [url],
    }));
  const result = [];
  let row = 0;
  for (const line of (text || "").split(/\r?\n/)) {
    const markdown = /^\s*\|/.test(line);
    let cells = line.split(line.includes("\t") ? "\t" : markdown ? "|" : /$^/);
    if (markdown) {
      cells = cells.slice(1);
      if (!cells.at(-1).trim()) cells.pop();
      if (cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell))) continue;
    }
    cells.forEach((cell, column) => {
      const urls = [...cell.matchAll(/https:\/\/[^\s<>"|)]+/g)]
        .map((match) => match[0])
        .filter(isImageUrl);
      result.push({ row, column, text: cell.trim(), urls });
    });
    row++;
  }
  return result;
}
export function readClipboardImages(html, text) {
  return readClipboardCells(html, text).flatMap((cell) =>
    cell.urls.map((url, i) => ({
      row: cell.row,
      column: cell.column + i,
      url,
    })),
  );
}
function isImageUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url) ||
      (parsed.protocol === "https:" &&
        /\.(png|jpe?g|webp|gif)(?:$)/i.test(parsed.pathname))
    );
  } catch {
    return false;
  }
}
export async function loadClipboardImage(url) {
  let response;
  const signal = AbortSignal.timeout(20000);
  if (new URL(url).hostname === "uploader.shimo.im") {
    response = await fetch("/api/shimo-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal,
    });
  } else response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? "图片链接已失效，请从石墨重新复制"
        : "图片读取失败，请重新复制或上传图片",
    );
  const blob = await response.blob();
  if (!blob.type.startsWith("image/"))
    throw new Error("链接没有返回图片，请重新复制");
  return new File([blob], "reference.png", { type: blob.type });
}
