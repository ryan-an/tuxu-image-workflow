import { selectVersion, savePrompt } from "../../shared/model.js";
import { api } from "../services/workspace-client.js";

import { portableBackup } from "../services/backup.js";

import { clipboardImageFiles } from "../integrations/media-upload.js";
import { retryableQueueJobs } from "../../shared/queue-progress.js";
import { PRODUCT_PAGE_SIZE } from "../view-models/product-page.js";

import { productPhotos } from "../../shared/prompt-suite.js";
import { removeProductRows } from "../../shared/sheet-data.js";

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
      setHasPromptKey,
      setAssistant,
      setFilter,
      editPrompt,
      editProduct,
      settings,
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
      exportTemplate,
      openMedia,
      activeMediaTarget,
      receiveMedia,
      chooseFiles,
    } = context;
    const p = currentProduct(),
      t = p?.tasks.find((t) => t.id === data.task);
    if (a === "select-version") return;
    switch (a) {
      case "ask-doubao":
        setAssistant({ open: true, productId: p?.id, taskId: data.task });
        break;
      case "open-assistant":
        setAssistant({
          ...ui.assistant,
          productId: ui.assistant.productId || p?.id,
          open: true,
        });
        break;
      case "close-assistant":
        setAssistant({ ...ui.assistant, open: false });
        break;
      case "view":
        await switchView(data.view);
        break;
      case "open-product":
      case "queue-open-product":
        if (a === "queue-open-product") {
          const index = state.products.findIndex(
            (product) => product.id === data.id,
          );
          if (index < 0) {
            notify("产品已不存在，请刷新列表");
            break;
          }
          ui.search = "";
          ui.productPage = Math.floor(index / PRODUCT_PAGE_SIZE) + 1;
        }
        state.activeProductId = data.id;
        setFilter("all");
        render();
        await repository?.loadProducts([data.id]);
        await switchView("workbench");
        saveSoon();
        break;
      case "new-product":
        editProduct(true);
        break;
      case "delete-product": {
        if (data.confirmed !== "true") break;
        await context.ensureAll?.();
        const product = state.products.find((item) => item.id === data.id);
        if (!product) break;
        if (
          state.jobs.some(
            (job) =>
              job.productId === product.id &&
              ["queued", "running", "interrupted"].includes(job.status),
          )
        )
          throw new Error(
            "该产品还有待执行、执行中或待核对任务，请先取消或处理后再删除",
          );
        await persist();
        if (repository) await repository.deleteProduct(product.id);
        else {
          state.products = state.products.filter(
            (item) => item.id !== product.id,
          );
          state.jobs = state.jobs.filter((job) => job.productId !== product.id);
          state.sheetSnapshot = removeProductRows(state.sheetSnapshot, product);
        }
        bridge.replaceSnapshot(state.sheetSnapshot);
        if (state.activeProductId === product.id)
          state.activeProductId = state.products[0]?.id || null;
        if (ui.assistant?.productId === product.id)
          setAssistant({ open: false });
        closeModal();
        change();
        await persist();
        notify(
          repository ? "产品已删除，无引用的图片会自动清理" : "产品已删除",
        );
        break;
      }
      case "edit-product":
      case "view-product":
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
      case "activity":
        showModal({ type: "activity" });
        break;
      case "clear-key":
      case "clear-prompt-key": {
        const result = await api(
          "/api/workflow/settings",
          a === "clear-prompt-key"
            ? { clearPromptKey: true }
            : { clearKey: true },
        );
        setHasKey(result.hasKey);
        setHasPromptKey(result.hasPromptKey);
        render();
        notify(
          a === "clear-prompt-key" ? "豆包密钥已清除" : "Grsai 生图密钥已清除",
        );
        break;
      }
      case "close-modal":
        closeModal();
        break;
      case "common-prompt":
      case "view-requirements":
        if (p) showModal({ type: "common", productId: p.id });
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
        await updateMetadata(p);
        change();
        openMedia(p);
        break;
      }
      case "generate-prompt":
        await queuePairs(
          (t ? [t] : p.tasks).map((task) => ({ product: p, task })),
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
        await queuePairs(currentPairs(), "full-workflow");
        break;
      case "pause-queue":
        await queue.pause(!state.paused);
        break;
      case "resume-interrupted":
        await queue.resumeInterrupted();
        break;
      case "cancel-pending":
        await queue.cancelPending();
        break;
      case "retry-failed":
      case "retry-product-failed": {
        const failures = retryableQueueJobs(state).filter(
          (job) => a !== "retry-product-failed" || job.productId === data.id,
        );
        let recovered = 0;
        const errors = [];
        for (const job of failures) {
          try {
            await queue.retry(job.id);
            recovered++;
          } catch (error) {
            errors.push(error.message);
          }
        }
        change();
        await queue.pump();
        notify(
          `已恢复 ${recovered} 个失败任务${state.paused ? "，队列仍暂停" : ""}${errors.length ? `；${errors.length} 个未恢复：${errors[0]}` : ""}`,
        );
        break;
      }
      case "download-batch-selected":
        await downloadSelected(true);
        break;
      case "cancel-job":
        await queue.cancel(data.id);
        break;
      case "cancel-product-analysis": {
        const ids = state.jobs
          .filter(
            (job) =>
              job.productId === data.id &&
              job.kind === "prompt-set" &&
              ["queued", "running"].includes(job.status),
          )
          .map((job) => job.id);
        for (const id of ids) await queue.cancel(id);
        break;
      }
      case "cancel-product-jobs":
        await queue.cancelProduct(data.id);
        break;
      case "retry-job":
        await queue.retry(data.id);
        break;
      case "query-job": {
        if (repository) {
          await queue.retry(data.id);
          break;
        }
        await queue.retry(data.id);
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
      case "export-template":
        await exportTemplate();
        break;
      case "import-sheet":
        $("#sheet-import-input").click();
        break;
      case "delete-sheet-rows":
        bridge.removeDraftRows();
        break;
      case "backup":
        if (repository && context.canEdit !== false) await persist();
        bridge.capture();
        downloadBlob(
          new Blob(
            [
              JSON.stringify(
                await portableBackup(
                  repository ? await api("/api/workspace") : state,
                ),
              ),
            ],
            {
              type: "application/json",
            },
          ),
          "图序-工作流备份.json",
        );
        break;
      case "restore":
        $("#restore-input").click();
        break;
      case "parse-sheet":
        await openParser();
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
    if (
      ["concurrency", "promptConcurrency", "queryConcurrency"].includes(el.id)
    ) {
      state[el.id] = Number(el.value);
      change();
      await queue.pump();
    }
  }

  return { action, onChange };
}
