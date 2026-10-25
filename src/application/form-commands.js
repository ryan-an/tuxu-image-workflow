import { newProduct, savePrompt, findTask } from "../../shared/model.js";
import { api } from "../services/workspace-client.js";
export function createFormCommands(context) {
  async function saveTaskPromptAndGenerate(productId, taskId, prompt) {
    if (!prompt.trim()) throw new Error("请先填写提示词");
    const { product, task } = findTask(context.state, productId, taskId);
    if (!task) throw new Error("该图片位置已不存在");
    if (task.prompt !== prompt) savePrompt(task, prompt);
    context.change();
    try {
      await context.syncTask(product, task, "prompt");
    } finally {
      await context.persist();
    }
    try {
      const pair = findTask(context.state, productId, taskId);
      if (!pair.task) throw new Error("该图片位置已不存在");
      const count = await context.queue.enqueue([pair], "image");
      if (!count) throw new Error("已有生图任务，请等待完成后重试");
      context.notify(
        "提示词已保存，图片已加入生成队列" +
          (context.state.paused ? "，队列已暂停" : ""),
      );
    } catch (error) {
      throw new Error(`提示词已保存，未能启动生成：${error.message}`);
    }
  }
  async function submit(event) {
    const {
      state,
      bridge,
      queue,
      notify,
      change,
      render,
      closeModal,
      setFormError,
      setHasKey,
      setHasPromptKey,
      syncTask,
      updateMetadata,
    } = context;
    if (
      !event.target.matches(
        "#settings-form,#product-form,#prompt-form,#reconcile-form",
      )
    )
      return;
    event.preventDefault();
    const form = event.target,
      values = Object.fromEntries(new FormData(form));
    if (form.id === "reconcile-form") {
      await queue.reconcile(form.dataset.id, {
        remoteId: values.remoteId,
        confirmNotAccepted: values.confirmNotAccepted === "on",
      });
      closeModal();
      return;
    }
    if (form.id === "prompt-form") {
      await saveTaskPromptAndGenerate(
        form.dataset.product,
        form.dataset.task,
        values.prompt,
      );
      closeModal();
    } else if (form.id === "settings-form") {
      if (values.promptModel === "__custom") {
        values.promptModel = values.customPromptModel?.trim();
        if (!values.promptModel) {
          setFormError("请填写豆包 Model ID 或 Endpoint ID");
          return;
        }
      }
      delete values.customPromptModel;
      const data = await api("/api/workflow/settings", values);
      setHasKey(data.hasKey);
      setHasPromptKey(data.hasPromptKey);
      delete data.hasKey;
      delete data.hasPromptKey;
      state.settings = data;
      closeModal();
      change();
      notify("服务设置已保存");
    } else if (form.id === "product-form") {
      const isNew = form.dataset.new === "true",
        old = state.products.find((p) => p.id === form.dataset.product),
        code = values.code.trim();
      if (
        state.products.some(
          (p) => p.code === code && (isNew || p.id !== old.id),
        )
      )
        return notify("该产品编号已存在");
      if (isNew) {
        const p = newProduct(code, values.name, values.facts);
        state.products.push(p);
        bridge.appendProduct(p);
        state.activeProductId = p.id;
      } else {
        const oldCode = old.code;
        old.code = code;
        old.name = values.name;
        old.facts = values.facts;
        await updateMetadata(old, oldCode);
      }
      closeModal();
      change();
    }
  }
  return { submit, saveTaskPromptAndGenerate };
}
