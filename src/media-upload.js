import { readClipboardImages, loadClipboardImage } from "./paste-images.js";
import { fileDataUrl } from "./sheet-bridge.js";

export async function transferImageFiles(transfer) {
  const files = [...(transfer.files || [])].filter((file) =>
    file.type.startsWith("image/"),
  );
  // Clipboard image data and HTML often describe the same image.
  if (files.length) return files;
  const urls = [
    ...new Set(
      readClipboardImages(
        transfer.getData("text/html"),
        transfer.getData("text/plain"),
      ).map((image) => image.url),
    ),
  ];
  const result = [];
  for (const url of urls) result.push(await loadClipboardImage(url));
  return result;
}

export async function clipboardImageFiles() {
  if (!navigator.clipboard?.read)
    throw new Error("请在此窗口按 Ctrl+V 粘贴图片，或选择文件。");
  let items;
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new Error("无法读取剪贴板，请在此窗口按 Ctrl+V 粘贴，或选择文件。");
  }
  const files = [];
  let html = "",
    text = "";
  for (const item of items) {
    const type = item.types.find((type) => type.startsWith("image/"));
    if (type) {
      files.push(new File([await item.getType(type)], "粘贴图片", { type }));
    } else {
      if (item.types.includes("text/html"))
        html += await (await item.getType("text/html")).text();
      if (item.types.includes("text/plain"))
        text += await (await item.getType("text/plain")).text();
    }
  }
  return files.length
    ? files
    : transferImageFiles({
        files: [],
        getData: (type) => (type === "text/html" ? html : text),
      });
}

export async function mediaSources(files) {
  const sources = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const source = await fileDataUrl(file),
      image = new Image();
    image.src = source;
    try {
      await image.decode();
    } catch {
      throw new Error("有图片无法打开，请重新复制或选择有效的图片文件。");
    }
    sources.push(source);
  }
  if (!sources.length)
    throw new Error("没有找到图片。请复制图片、截图或石墨图片单元格后再粘贴。");
  return [...new Set(sources)];
}
