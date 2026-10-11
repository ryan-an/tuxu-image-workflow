// Domain objects stay owned by the workspace client. UI drafts stay in mounted forms.
// Each publication creates a new snapshot envelope for useSyncExternalStore.
export function createStateStore() {
  const ui = {
    view: "workbench",
    search: "",
    filter: "all",
    modal: null,
    toast: "",
    saveStatus: "正在加载…",
    hasKey: false,
    parser: null,
    exporting: false,
    formError: "",
    mediaFeedback: "",
    mediaError: false,
  };
  let state,
    isRemote = false,
    ready = false,
    disposed = false,
    key = 0,
    toastTimer,
    snapshot = { ready: false };
  const listeners = new Set();
  function publish() {
    if (disposed) return;
    snapshot = ready
      ? { ready: true, state, ui: { ...ui }, isRemote }
      : { ready: false };
    for (const listener of listeners) listener();
  }
  function update(field, value) {
    ui[field] = value;
    publish();
  }
  function notify(message) {
    update("toast", message);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => update("toast", ""), 5500);
  }
  return {
    ui,
    publish,
    notify,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    attach: (workspace, remote) => {
      state = workspace;
      isRemote = remote;
      ready = true;
      publish();
    },
    fail: (error) => {
      snapshot = { ready: false, error: error.message };
      for (const listener of listeners) listener();
    },
    showModal: (modal) => {
      ui.formError = "";
      ui.modal = { ...modal, key: ++key };
      publish();
    },
    closeModal: () => {
      ui.modal = null;
      ui.formError = "";
      publish();
    },
    setSaveStatus: (value) => update("saveStatus", value),
    setFormError: (value) => update("formError", value),
    setHasKey: (value) => update("hasKey", value),
    setView: (value) => update("view", value),
    setFilter: (value) => update("filter", value),
    setSearch: (value) => update("search", value),
    setExporting: (value) => update("exporting", value),
    dispose: () => {
      disposed = true;
      clearTimeout(toastTimer);
      listeners.clear();
    },
  };
}
