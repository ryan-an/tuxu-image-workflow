import { selectVersion, savePrompt } from "../model.js";
import { api } from "../services/workspace-client.js";

import { portableBackup } from "../services/backup.js";

import { clipboardImageFiles } from "../media-upload.js";
import { retryableQueueJobs } from "../queue-view.js";

import { productPhotos } from "../prompt-suite.js";

const $ = (selector) => document.querySelector(selector);
export function createCommands(context) {
  async function action(a, data = {}) {
    const {
      state,
      repository,
      bridge,
      queue,
      ui,
      notify,
      change,
      saveSoon,
      persist,
      render,
      currentProduct,
      currentPairs,
      showModal,
      closeModal,
      setHasKey,
      setFilter,
      editPrompt,
      editProduct,
      settings,
      keySettings,
      viewVersion,
      syncTask,
      updateMetadata,
      switchView,
      openParser,
      confirmParse,
      queuePairs,
      downloadBlob,
      downloadSelected,
      exportExcel,
      openMedia,
      activeMediaTarget,
      receiveMedia,
      chooseFiles,
    } = context;
    const p = currentProduct(),
      t = p?.tasks.find((t) => t.id === data.task);
    if (a === "select-version") return;
    switch (a) {
      case "view":
        await switchView(data.view);
        break;
      case "open-product":
      case "queue-open-product":
        state.activeProductId = data.id;
        setFilter("all");
        await switchView("workbench");
        saveSoon();
        break;
      case "new-product":
        editProduct(true);
        break;
      case "edit-product":
        editProduct();
        break;
      case "edit-prompt":
        editPrompt(p, t);
        break;
      case "filter-tasks":
        setFilter(data.filter);
        render();
        break;
      case "save":
        await persist();
        notify(repository ? "已保存到服务端" : "已保存到本机");
        break;
      case "settings":
        settings();
        break;
      case "key-settings":
        keySettings();
        break;
      case "clear-key": {
        const r = await fetch("/api/workflow/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clearKey: true }),
        });
        if (!r.ok) throw new Error("清除密钥失败");
        setHasKey(false);
        closeModal();
        render();
        notify("密钥已清除");
        break;
      }
      case "close-modal":
        closeModal();
        break;
      case "common-prompt":
        showModal({ type: "common" });
        break;
      case "upload-reference":
      case "manage-references":
        openMedia(p, t);
        break;
      case "upload-photo":
      case "manage-photos":
        openMedia(p);
        break;
      case "choose-image-files":
        if (!activeMediaTarget()) break;
        chooseFiles(data.replace === "true");
        break;
      case "paste-media":
        if (activeMediaTarget())
          await receiveMedia(clipboardImageFiles, { ...activeMediaTarget() });
        break;
      case "remove-photo": {
        const photos = productPhotos(p);
        photos.splice(Number(data.index), 1);
        p.photos = photos;
        p.photo = photos[0] || "";
        for (const task of p.tasks) delete task.realPhotoIndices;
        updateMetadata(p);
        change();
        openMedia(p);
        break;
      }
      case "generate-prompt":
        await queuePairs(
          p.tasks.map((task) => ({ product: p, task })),
          "prompt",
        );
        break;
      case "generate-image":
        await queuePairs(
          [{ product: p, task: t }],
          t.prompt ? "image" : "workflow",
        );
        break;
      case "batch-prompt":
        await queuePairs(currentPairs(), "prompt");
        break;
      case "batch-images":
        if (p?.tasks.some((task) => !task.prompt.trim())) {
          notify("请先生成本套整套提示词，或使用执行本套流程");
          break;
        }
        await queuePairs(currentPairs(), "image");
        break;
      case "batch-workflow":
        await queuePairs(currentPairs(), "workflow");
        break;
      case "pause-queue":
        await queue.pause(!state.paused);
        break;
      case "resume-interrupted":
        await queue.resumeInterrupted();
        break;
      case "cancel-pending":
        for (const j of state.jobs.filter((j) => j.status === "queued"))
          await queue.cancel(j.id);
        break;
      case "generate-remaining": {
        const pairs = state.products.flatMap((product) =>
          product.tasks
            .filter((task) => !task.versions.length)
            .map((task) => ({ product, task })),
        );
        await queuePairs(pairs, "workflow");
        break;
      }
      case "retry-failed": {
        const failures = retryableQueueJobs(state);
        for (const job of failures) {
          if (repository) {
            await queue.retry(job.id);
            continue;
          }
          if (job.remoteId) {
            job.status = "queued";
            job.error = "";
          } else await queue.retry(job.id);
        }
        change();
        queue.pump();
        notify(
          `已恢复 ${failures.length} 个失败任务${state.paused ? "，队列仍暂停" : ""}`,
        );
        break;
      }
      case "download-batch-selected":
        await downloadSelected(true);
        break;
      case "cancel-job":
        await queue.cancel(data.id);
        break;
      case "cancel-product-jobs":
        for (const job of state.jobs.filter(
          (job) =>
            job.productId === data.id &&
            ["queued", "running"].includes(job.status),
        ))
          await queue.cancel(job.id);
        break;
      case "retry-job":
        await queue.retry(data.id);
        break;
      case "query-job": {
        if (repository) {
          await queue.retry(data.id);
          break;
        }
        const j = state.jobs.find((j) => j.id === data.id);
        j.status = "queued";
        queue.pause(false);
        break;
      }
      case "reconcile-job":
        showModal({ type: "reconcile", id: data.id });
        break;
      case "choose-version":
        selectVersion(t, data.version, true);
        change();
        await syncTask(p, t, "result");
        break;
      case "view-version":
        viewVersion(
          t,
          t.versions.find((v) => v.id === data.version),
        );
        break;
      case "modal-primary": {
        const task = p.tasks.find((t) => t.id === ui.modal.taskId);
        selectVersion(task, ui.modal.versionId, true);
        closeModal();
        change();
        await syncTask(p, task, "result");
        break;
      }
      case "download-version": {
        const v = t.versions.find((v) => v.id === data.version);
        downloadBlob(
          await (await fetch(v.source)).blob(),
          `${p.code}-${t.role}-V${v.number}.${v.source.startsWith("data:image/jpeg") ? "jpg" : v.source.startsWith("data:image/webp") ? "webp" : "png"}`,
        );
        break;
      }
      case "download-selected":
        await downloadSelected();
        break;
      case "export-excel":
        await exportExcel();
        break;
      case "backup":
        if (repository) await persist();
        bridge.capture();
        downloadBlob(
          new Blob([JSON.stringify(await portableBackup(state))], {
            type: "application/json",
          }),
          "图序-工作流备份.json",
        );
        break;
      case "restore":
        $("#restore-input").click();
        break;
      case "parse-sheet":
        openParser();
        break;
      case "confirm-parse":
        await confirmParse();
        break;
      case "paste-links":
        showModal({ type: "paste" });
        break;
      case "paste-insert": {
        const c = new DataTransfer();
        c.setData("text/plain", $("#paste-content").value);
        closeModal();
        await bridge.paste(c);
        break;
      }
      case "prompt-history":
        showModal({ type: "prompt-history", productId: p.id, taskId: t.id });
        break;
      case "restore-prompt":
        savePrompt(t, t.promptHistory[Number(data.index)].prompt);
        await syncTask(p, t, "prompt");
        closeModal();
        change();
        break;
      case "remove-reference":
        t.references.splice(Number(data.index), 1);
        await syncTask(p, t, "reference");
        change();
        openMedia(p, t);
        break;
      default:
        throw new Error(`未知操作：${a}`);
    }
  }

  async function onChange(event) {
    const { state, queue, change, currentProduct, syncTask } = context;
    const el = event.target,
      a = el.dataset.action,
      p = currentProduct();
    if (a === "select-version") {
      const t = p.tasks.find((t) => t.id === el.dataset.task);
      selectVersion(t, el.dataset.version, el.checked);
      change();
      if (el.checked) await syncTask(p, t, "result");
    }
    if (el.id === "concurrency") {
      state.concurrency = Number(el.value);
      change();
      await queue.pump();
    }
  }

  return { action, onChange };
}
