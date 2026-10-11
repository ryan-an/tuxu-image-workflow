import { APP_KEY } from "../model.js";
import { saveSnapshot } from "../storage.js";

export function createPersistence(context) {
  let saveTimer,
    dirty = false,
    disposed = false,
    saveChain = Promise.resolve();
  function saveSoon() {
    if (disposed) return;
    dirty = true;
    context.setSaveStatus("保存中…");
    if (!saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void persist().catch(() => {});
      }, 1000);
  }
  async function persist() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const { state, repository, bridge, setSaveStatus, notify } = context;
    bridge?.capture();
    dirty = false;
    try {
      if (repository) await repository.save();
      else {
        const snapshot = structuredClone(state);
        saveChain = saveChain
          .catch(() => {})
          .then(() => saveSnapshot(APP_KEY, snapshot));
        await saveChain;
      }
      setSaveStatus(
        dirty ? "保存中…" : repository ? "已保存到服务端" : "已保存到本机",
      );
    } catch (error) {
      dirty = true;
      setSaveStatus("保存失败 · 草稿保留");
      notify(error.message);
      throw error;
    }
  }
  return {
    saveSoon,
    persist,
    dispose: () => {
      disposed = true;
      clearTimeout(saveTimer);
    },
  };
}
