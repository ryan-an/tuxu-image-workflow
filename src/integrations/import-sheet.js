import { api } from "../services/workspace-client.js";
import { fileDataUrl } from "./sheet-bridge.js";
export async function importSheetFile(file) {
  if (!/\.xlsx$/i.test(file.name))
    throw new Error("请选择 XLSX 文件；旧版 XLS 请先另存为 XLSX");
  if (file.size > 50 * 1024 * 1024)
    throw new Error("文件超过50MB，请拆分后导入");
  const source = await fileDataUrl(file);
  return api("/api/workspace/sheet-import/preview", {
    name: file.name,
    data: source.slice(source.indexOf(",") + 1),
  });
}
