import { findTask } from "../model.js";

import { mediaSources } from "../media-upload.js";

import { productPhotos } from "../prompt-suite.js";

const $ = (selector) => document.querySelector(selector);
export function createMedia(context) {
  let uploadTarget = null,
    fileUploadTarget = null,
    mediaUploadChain = Promise.resolve();
  function activeMediaTarget() {
    const { ui } = context;
    return ui.modal?.type === "media" ? uploadTarget : null;
  }

  function sameMediaTarget(target) {
    const { activeMediaTarget } = context;
    const active = activeMediaTarget();
    return (
      active &&
      active.productId === target.productId &&
      active.taskId === target.taskId
    );
  }

  function openMedia(product, task) {
    const { ui, publish, showModal } = context;
    const same =
      ui.modal?.type === "media" &&
      ui.modal.productId === product.id &&
      ui.modal.taskId === task?.id;
    if (!same) {
      ui.mediaFeedback = "";
      ui.mediaError = false;
      showModal({ type: "media", productId: product.id, taskId: task?.id });
    }
    uploadTarget = { productId: product.id, taskId: task?.id };
    publish();
  }

  function mediaFeedback(target, text, isError = false) {
    const { ui, publish } = context;
    if (!sameMediaTarget(target)) return;
    ui.mediaFeedback = text;
    ui.mediaError = isError;
    publish();
  }

  function receiveMedia(readFiles, target) {
    const { state, notify, change, syncTask, updateMetadata, openMedia } =
      context;
    // Capture the destination before asynchronous reads, and serialize additions.
    let reading;
    try {
      reading = Promise.resolve(readFiles());
    } catch (error) {
      reading = Promise.reject(error);
    }
    reading.catch(() => {});
    mediaFeedback(target, "正在读取图片…");
    const run = mediaUploadChain.then(async () => {
      const sources = await mediaSources(await reading);
      const { product, task } = findTask(
        state,
        target.productId,
        target.taskId,
      );
      if (!product || (target.taskId && !task))
        throw new Error("目标产品或图片位置已不存在");
      const existing = task ? task.references : productPhotos(product);
      const next = target.replace
        ? sources
        : [...new Set([...existing, ...sources])];
      const added = target.replace
        ? next.length
        : next.length - existing.length;
      if (task) task.references = next;
      else {
        product.photos = next;
        product.photo = next[0] || "";
        for (const item of product.tasks) delete item.realPhotoIndices;
        updateMetadata(product);
      }
      change();
      if (task) await syncTask(product, task, "reference");
      const message = target.replace
        ? `已替换为 ${added} 张图片`
        : added
          ? `已添加 ${added} 张图片${sources.length > added ? "，重复图片已跳过" : ""}`
          : "这些图片已经添加过了，已跳过重复图片";
      if (sameMediaTarget(target)) {
        openMedia(product, task);
        mediaFeedback(target, message);
      }
      notify(message);
    });
    mediaUploadChain = run.catch((error) => {
      mediaFeedback(target, error.message, true);
      notify(error.message);
    });
    return mediaUploadChain;
  }

  function mediaDropTarget(event) {
    const { ui, view, currentProduct, activeMediaTarget } = context;
    const active = activeMediaTarget();
    if (active && $("#media-uploader").contains(event.target))
      return { element: $("#media-dropzone"), target: { ...active } };
    if (!!ui.modal || view !== "workbench") return null;
    const element = event.target.closest?.(".reference,.product-photo");
    const product = currentProduct();
    if (!element || !product) return null;
    return {
      element,
      target: { productId: product.id, taskId: element.dataset.task },
    };
  }

  function uploadFiles(e) {
    const { activeMediaTarget, receiveMedia } = context;
    const target = fileUploadTarget || activeMediaTarget(),
      files = [...e.target.files];
    e.target.value = "";
    fileUploadTarget = null;
    if (target && files.length) void receiveMedia(() => files, { ...target });
  }
  function chooseFiles(replace) {
    fileUploadTarget = { ...activeMediaTarget(), replace };
    $("#image-input").click();
  }
  return {
    activeMediaTarget,
    sameMediaTarget,
    openMedia,
    mediaFeedback,
    receiveMedia,
    mediaDropTarget,
    uploadFiles,
    chooseFiles,
  };
}
