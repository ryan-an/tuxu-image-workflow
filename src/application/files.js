import { saveSnapshot } from "../integrations/storage.js";
import { APP_KEY, validBackup, uid } from "../../shared/model.js";
import { api } from "../services/workspace-client.js";

export function createFiles(context) {
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadSelected(allProducts = false) {
    if (allProducts) await context.ensureAll?.();
    const { state, notify, currentProduct, downloadBlob } = context;
    const products = allProducts
        ? state.products
        : [currentProduct()].filter(Boolean),
      images = products.flatMap((p) =>
        p.tasks.flatMap((t) =>
          t.versions
            .filter((v) =>
              (context.canEdit === false
                ? context.ui.downloadSelections[t.id] || t.selectedIds
                : t.selectedIds
              ).includes(v.id),
            )
            .map((v) => ({ p, t, v })),
        ),
      );
    if (!images.length) return notify("请先勾选要下载的历史图片");
    const { default: JSZip } = await import("jszip"),
      zip = new JSZip();
    for (const { p, t, v } of images) {
      const response = await fetch(v.source);
      if (!response.ok) throw new Error(`图片下载失败 (${response.status})`);
      const blob = await response.blob();
      const meta = blob.type,
        ext = meta.includes("jpeg")
          ? "jpg"
          : meta.includes("webp")
            ? "webp"
            : "png",
        safe = (s) => s.replace(/[\\/:*?"<>|]/g, "_");
      zip.file(
        `${safe(p.code)}/${safe(t.role)}-V${v.number}.${ext}`,
        await blob.arrayBuffer(),
      );
    }
    downloadBlob(
      await zip.generateAsync({ type: "blob" }),
      "图序-选中结果.zip",
    );
    notify(`已打包 ${images.length} 张选中图片`);
  }

  async function exportExcel() {
    const { bridge, notify, setExporting, downloadBlob } = context;
    setExporting(true);
    notify("正在导出 Excel，包含表格图片…");
    try {
      await context.ensureAll?.();
      await bridge.reconcile();
      const { exportExcel } = await import("../integrations/export-excel.js"),
        { buffer, imageCount } = await exportExcel(bridge.snapshot());
      downloadBlob(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        "图序-工作流.xlsx",
      );
      notify(`已导出 Excel · ${imageCount} 张图片`);
    } catch (error) {
      notify("导出失败：" + error.message);
    } finally {
      setExporting(false);
    }
  }

  async function restoreBackup(e) {
    const { repository, notify } = context;
    if (!e.target.files?.length) return;
    try {
      const restored = JSON.parse(await e.target.files[0].text());
      if (!validBackup(restored)) throw new Error("不是有效备份");
      if (repository) {
        await api("/api/workspace/import", {
          commandId: uid(),
          workspace: restored,
        });
        location.reload();
        return;
      }
      for (const j of restored.jobs)
        if (["queued", "running"].includes(j.status)) j.status = "interrupted";
      restored.paused = true;
      await saveSnapshot(APP_KEY, restored);
      location.reload();
    } catch (error) {
      notify("恢复失败：" + error.message);
    } finally {
      e.target.value = "";
    }
  }

  async function exportTemplate() {
    const { notify, setExporting, downloadBlob } = context;
    setExporting(true);
    try {
      const { exportSheetTemplate } = await import(
        "../integrations/sheet-template.js"
      );
      const buffer = await exportSheetTemplate();
      downloadBlob(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        "图序-产品导入模板.xlsx",
      );
      notify("已导出模板，包含一个示例产品及填写说明");
    } catch (error) {
      notify("模板导出失败：" + error.message);
    } finally {
      setExporting(false);
    }
  }

  return {
    downloadBlob,
    downloadSelected,
    exportExcel,
    exportTemplate,
    restoreBackup,
  };
}
