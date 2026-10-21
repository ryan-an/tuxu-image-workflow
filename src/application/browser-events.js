import { findTask } from "../../shared/model.js";

import { readClipboardCells } from "../integrations/paste-images.js";
import { transferImageFiles } from "../integrations/media-upload.js";

const $ = (selector) => document.querySelector(selector);
export function bindBrowserEvents(context) {
  const {
    state,
    bridge,
    notify,
    closeModal,
    openMedia,
    activeMediaTarget,
    receiveMedia,
    mediaDropTarget,
  } = context;
  const cleanup = [];
  const listen = (type, handler, capture = false) => {
    document.addEventListener(type, handler, capture);
    cleanup.push(() => document.removeEventListener(type, handler, capture));
  };
  listen(
    "paste",
    (e) => {
      const target = activeMediaTarget();
      if (target && e.clipboardData) {
        e.preventDefault();
        e.stopImmediatePropagation();
        void receiveMedia(() => transferImageFiles(e.clipboardData), {
          ...target,
        });
        return;
      }
      if (context.view !== "sheet" || !e.clipboardData) return;
      const inModal = e.target.id === "paste-content";
      if (!!context.ui.modal && !inModal) return;
      if (
        !inModal &&
        !$("#sheet-container").contains(e.target) &&
        e.target !== document.body
      )
        return;
      const cells = readClipboardCells(
        e.clipboardData.getData("text/html"),
        e.clipboardData.getData("text/plain"),
      );
      if (
        !cells.some((cell) => cell.urls.length) &&
        !e.clipboardData.files.length
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (inModal) closeModal();
      void bridge
        .paste(e.clipboardData, cells)
        .catch((error) => notify(error.message));
    },
    true,
  );
  listen("dragover", (e) => {
    const drop = mediaDropTarget(e);
    if (!drop) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    drop.element.classList.add("media-dragover");
  });
  listen("dragleave", (e) => {
    const drop = mediaDropTarget(e);
    if (drop && !drop.element.contains(e.relatedTarget))
      drop.element.classList.remove("media-dragover");
  });
  listen("drop", (e) => {
    const drop = mediaDropTarget(e);
    if (!drop) return;
    e.preventDefault();
    document
      .querySelectorAll(".media-dragover")
      .forEach((el) => el.classList.remove("media-dragover"));
    if (!activeMediaTarget()) {
      const { product, task } = findTask(
        state,
        drop.target.productId,
        drop.target.taskId,
      );
      openMedia(product, task);
    }
    void receiveMedia(() => transferImageFiles(e.dataTransfer), drop.target);
  });

  return () => cleanup.forEach((remove) => remove());
}
