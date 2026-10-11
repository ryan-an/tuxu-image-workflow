import { createCommands } from "./commands.js";
import { createFormCommands } from "./form-commands.js";
import { createMedia } from "./media.js";
import { createSheet } from "./sheet.js";
import { createFiles } from "./files.js";
import { createThumbnails } from "./thumbnails.js";
import { createPersistence } from "./persistence.js";
import { createStateStore } from "./state-store.js";
import { loadWorkspace } from "./bootstrap.js";
import { bindBrowserEvents } from "./browser-events.js";
import { WorkspaceClient } from "../services/workspace-client.js";
import { RemoteQueue } from "../services/remote-queue.js";
import { SheetBridge, parseSheet } from "../sheet-bridge.js";

/** @returns {import("../ui/types.ts").ApplicationController} */
export function createApplicationController() {
  const store = createStateStore(),
    { ui, publish, notify, showModal, closeModal } = store;
  let state,
    repository,
    bridge,
    queue,
    ready = false,
    disposed = false;
  let cleanupEvents = () => {};
  function currentProduct() {
    return (
      state.products.find(
        (p) => p.id === (ui.modal?.productId || state.activeProductId),
      ) || state.products[0]
    );
  }
  function render() {
    if (ready && !disposed) {
      context.prepareThumbnails();
      publish();
    }
  }
  function change() {
    render();
    context.saveSoon();
  }
  function currentPairs() {
    const product = currentProduct();
    return product ? product.tasks.map((task) => ({ product, task })) : [];
  }
  const safe =
    (work) =>
    async (...args) => {
      const modalKey = ui.modal?.key;
      try {
        await work(...args);
      } catch (error) {
        if (ui.modal && ui.modal.key === modalKey)
          store.setFormError(error.message);
        notify(error.message);
      }
    };
  const context = {
    ...store,
    get state() {
      return state;
    },
    get repository() {
      return repository;
    },
    get bridge() {
      return bridge;
    },
    get queue() {
      return queue;
    },
    get hasKey() {
      return ui.hasKey;
    },
    get view() {
      return ui.view;
    },
    currentProduct,
    currentPairs,
    render,
    change,
    editPrompt: (product, task) =>
      showModal({ type: "prompt", productId: product.id, taskId: task.id }),
    editProduct: (isNew = false) =>
      showModal({
        type: "product",
        isNew,
        productId: isNew ? undefined : currentProduct()?.id,
      }),
    settings: () => showModal({ type: "settings" }),
    keySettings: () => showModal({ type: "key" }),
    viewVersion: (task, version) =>
      showModal({
        type: "version",
        productId: currentProduct().id,
        taskId: task.id,
        versionId: version.id,
      }),
    queuePairs: async (pairs, kind) => {
      if (!pairs.length) return notify("当前没有可执行的产品图片位置");
      if (state.settings.mode === "live" && !ui.hasKey) {
        context.settings();
        return notify("请先填写 Grsai 密钥，再执行真实生成");
      }
      const count = await queue.enqueue(pairs, kind);
      notify(
        count
          ? "已加入 " + count + " 个任务" + (state.paused ? "，队列已暂停" : "")
          : "这些位置已有待执行任务",
      );
    },
  };
  const persistence = createPersistence(context);
  Object.assign(
    context,
    { saveSoon: persistence.saveSoon, persist: persistence.persist },
    createMedia(context),
    createSheet(context),
    createFiles(context),
    createThumbnails(context),
    createCommands(context),
    createFormCommands(context),
  );
  async function start() {
    const loaded = await loadWorkspace();
    if (disposed) return;
    state = loaded.state;
    ui.hasKey = loaded.hasKey;
    bridge = new SheetBridge(state, context.saveSoon, notify);
    if (loaded.production) {
      repository = new WorkspaceClient(state, {
        render,
        sync: context.syncTask,
        notify,
      });
      const errors = await bridge.reconcile();
      if (errors.length) notify("结果已保留，表格回填失败：" + errors[0]);
      queue = new RemoteQueue(state, repository, notify);
    } else {
      const { GenerationQueue } = await import("../queue.js");
      queue = new GenerationQueue(state, {
        change,
        sync: context.syncTask,
        notify,
        persist: context.persist,
      });
      window.workflow = {
        state,
        bridge,
        queue,
        switchView: context.switchView,
        persist: context.persist,
        parseSheet,
      };
    }
    if (disposed) {
      repository?.stop();
      return;
    }
    ready = true;
    store.attach(state, !!repository);
    cleanupEvents = bindBrowserEvents(context);
    render();
    repository?.start();
    context.saveSoon();
    if (loaded.unfinished.length && !loaded.production)
      notify("未完成任务已暂停，可在队列恢复。");
  }
  return {
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    start: async () => {
      try {
        await start();
      } catch (error) {
        store.fail(error);
        console.error(error);
      }
    },
    dispatch: safe(context.action),
    submit: safe(context.submit),
    changeField: safe(context.onChange),
    uploadFiles: context.uploadFiles,
    restoreBackup: context.restoreBackup,
    setSearch: store.setSearch,
    closeModal,
    updateParser: context.updateParser,
    dispose: () => {
      disposed = true;
      repository?.stop();
      persistence.dispose();
      cleanupEvents();
      store.dispose();
      bridge?.dispose();
    },
  };
}
