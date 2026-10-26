import { productPage } from "../view-models/product-page.js";
import { createCommands } from "./commands.js";
import { createFormCommands } from "./form-commands.js";
import { createRequirementCommands } from "./requirements.js";
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
import { SheetBridge, parseSheet } from "../integrations/sheet-bridge.js";
import { actionAllowed, can } from "../../shared/access.js";
import { setSessionWorkspace } from "../services/session-scope.js";
import { WorkspaceCollaborationClient } from "../services/workspace-collaboration.js";

/** @returns {import("../ui/types.ts").ApplicationController} */
export function createApplicationController(
  user = {
    id: "owner",
    username: "admin",
    displayName: "所有者",
    workspaceId: "default",
    workspaceName: "默认团队",
    role: "owner",
  },
  { initialView = "workbench" } = {},
) {
  setSessionWorkspace(user.workspaceId, user.id);
  const store = createStateStore(),
    { ui, publish, notify, showModal, closeModal } = store;
  ui.view = initialView;
  let state,
    repository,
    bridge,
    queue,
    collaboration,
    ready = false,
    disposed = false;
  let cleanupEvents = () => {};
  let loadingProduct, failedProduct;
  function loadActiveProduct() {
    const product = currentProduct();
    if (
      !repository ||
      !product?._summary ||
      loadingProduct === product.id ||
      failedProduct === product.id
    )
      return;
    loadingProduct = product.id;
    ui.productError = "";
    void repository
      .loadProducts([product.id])
      .catch((error) => {
        failedProduct = product.id;
        if (currentProduct()?.id === product.id)
          ui.productError = error.message;
      })
      .finally(() => {
        if (loadingProduct === product.id) loadingProduct = null;
        if (!disposed) publish();
      });
  }
  function currentProduct() {
    return (
      state.products.find(
        (p) => p.id === (ui.modal?.productId || state.activeProductId),
      ) || state.products[0]
    );
  }
  function render() {
    if (ready && !disposed) {
      bridge?.setProducts(productPage(state, ui).products);
      context.prepareThumbnails();
      loadActiveProduct();
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
    canEdit: can(user.role, "edit"),
    canManage: can(user.role, "manage"),
    user,
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
    ensureSheet: () => repository?.loadSheet(),
    ensureAll: () => repository?.loadAll(),
    editPrompt: (product, task) =>
      showModal({ type: "prompt", productId: product.id, taskId: task.id }),
    editProduct: (isNew = false) =>
      showModal({
        type: "product",
        isNew,
        productId: isNew ? undefined : currentProduct()?.id,
      }),
    settings: () => showModal({ type: "settings" }),
    viewVersion: (task, version) =>
      showModal({
        type: "version",
        productId: currentProduct().id,
        taskId: task.id,
        versionId: version.id,
      }),
    queuePairs: async (pairs, kind) => {
      if (!pairs.length) return notify("当前没有可执行的产品图片位置");
      const promptOnly = ["prompt", "prompt-set"].includes(kind);
      const needsPrompt =
        promptOnly ||
        kind === "full-workflow" ||
        (kind === "workflow" && pairs.some(({ task }) => !task.prompt.trim()));
      if (
        state.settings.mode === "live" &&
        ((!promptOnly && !ui.hasKey) || (needsPrompt && !ui.hasPromptKey))
      ) {
        if (!context.canManage)
          return notify("请联系所有者配置豆包和 Grsai API Key");
        context.settings();
        return notify(
          needsPrompt && !ui.hasPromptKey
            ? "请先填写豆包 API Key"
            : "请先填写 Grsai 生图 API Key",
        );
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
    createRequirementCommands(context),
  );
  async function start() {
    const loaded = await loadWorkspace({
      canImport:
        context.canManage &&
        user.workspaceId === "default" &&
        user.id === "owner",
    });
    if (disposed) return;
    state = loaded.state;
    ui.hasKey = loaded.hasKey;
    ui.hasPromptKey = loaded.hasPromptKey;
    if (loaded.production) {
      repository = new WorkspaceClient(state, {
        render,
        capture: () => bridge?.capture(),
        syncSheet: (previous) => {
          if (!previous) bridge?.initializeSnapshot();
          bridge?.acceptRemoteSnapshot(previous);
        },
        sync: context.syncTask,
        syncBatch: async (work) => {
          await bridge.batch(work);
          context.saveSoon();
        },
        notify,
      });
    }
    bridge = new SheetBridge(
      state,
      context.saveSoon,
      notify,
      store.setSheetConflicts,
    );
    bridge.setProducts(productPage(state, ui).products);
    if (loaded.production) {
      const errors =
        state.sheetLoaded === false ? [] : await bridge.reconcile();
      if (errors.length) notify("结果已保留，表格回填失败：" + errors[0]);
      queue = new RemoteQueue(state, repository, notify);
      if (context.canEdit) {
        collaboration = new WorkspaceCollaborationClient(
          repository,
          bridge,
          (peers) => {
            ui.sheetPeers = peers;
            publish();
          },
        );
        collaboration.start();
      }
    } else {
      const { GenerationQueue } = await import("../demo/queue.js");
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
      collaboration?.stop();
      return;
    }
    ready = true;
    store.attach(state, !!repository);
    cleanupEvents = context.canEdit ? bindBrowserEvents(context) : () => {};
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
    dispatch: safe(async (action, data) => {
      if (!actionAllowed(user.role, action))
        throw new Error("当前账号没有此操作权限");
      if (["open-product", "queue-open-product"].includes(action)) {
        failedProduct = null;
        ui.productError = "";
      }
      await context.action(action, data);
    }),
    flush: persistence.persist,
    saveProductRequirements: (...args) =>
      context.saveProductRequirements(...args),
    savePromptTemplate: (...args) => context.savePromptTemplate(...args),
    deletePromptTemplate: (...args) => context.deletePromptTemplate(...args),
    saveTaskPromptAndGenerate: async (...args) => {
      if (!context.canEdit) throw new Error("查看者不能修改提示词");
      await context.saveTaskPromptAndGenerate(...args);
    },
    submit: safe(async (event) => {
      if (!context.canEdit) throw new Error("查看者不能修改资料");
      if (event.target.id === "product-form") await context.ensureSheet();
      await context.submit(event);
    }),
    changeField: safe(async (event) => {
      if (!context.canEdit) {
        const el = event.target;
        if (el.dataset.action !== "select-version") return;
        const task = currentProduct()?.tasks.find(
          (t) => t.id === el.dataset.task,
        );
        if (!task) return;
        const selected = new Set(
          ui.downloadSelections[task.id] || task.selectedIds,
        );
        if (el.checked) selected.add(el.dataset.version);
        else selected.delete(el.dataset.version);
        ui.downloadSelections[task.id] = [...selected];
        render();
        return;
      }
      if (event.target.id === "concurrency" && !context.canManage)
        throw new Error("仅所有者可修改并发上限");
      await context.onChange(event);
    }),
    uploadFiles: (event) => {
      if (context.canEdit) context.uploadFiles(event);
    },
    restoreBackup: async (event) => {
      if (context.canManage) await context.restoreBackup(event);
    },
    setSearch: (value) => {
      ui.search = value;
      ui.productPage = 1;
      render();
    },
    setProductPage: (value) => {
      ui.productPage = value;
      const page = productPage(state, ui);
      if (
        page.products.length &&
        !page.products.some((p) => p.id === state.activeProductId)
      )
        state.activeProductId = page.products[0].id;
      render();
    },
    closeModal,
    updateParser: context.updateParser,
    resolveSheetConflict: safe(context.resolveSheetConflict),
    dispose: () => {
      disposed = true;
      collaboration?.stop();
      repository?.stop();
      persistence.dispose();
      cleanupEvents();
      store.dispose();
      bridge?.dispose();
    },
  };
}
