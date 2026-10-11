import { newProduct, savePrompt, findTask } from "../model.js";
export function createFormCommands(context) {
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
      syncTask,
      updateMetadata,
    } = context;
    if (
      !event.target.matches(
        "#settings-form,#product-form,#common-form,#key-form,#prompt-form,#reconcile-form",
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
      const { product, task } = findTask(
        state,
        form.dataset.product,
        form.dataset.task,
      );
      if (!task) throw new Error("该图片位置已不存在");
      if (task.prompt !== values.prompt) savePrompt(task, values.prompt);
      change();
      closeModal();
      await syncTask(product, task, "prompt");
      notify("提示词已保存");
    } else if (form.id === "key-form") {
      const r = await fetch("/api/workflow/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: values.apiKey }),
        }),
        data = await r.json();
      if (!r.ok) {
        setFormError(data.error);
        return;
      }
      setHasKey(data.hasKey);
      closeModal();
      render();
      notify("密钥已配置，尚未启动生成任务");
    } else if (form.id === "settings-form") {
      if (values.promptModel === "__custom") {
        values.promptModel = values.customPromptModel?.trim();
        if (!values.promptModel) {
          setFormError("请填写平台模型名称");
          return;
        }
      }
      delete values.customPromptModel;
      const r = await fetch("/api/workflow/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        }),
        data = await r.json();
      if (!r.ok) {
        setFormError(data.error);
        return;
      }
      setHasKey(data.hasKey);
      delete data.hasKey;
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
        updateMetadata(old, oldCode);
      }
      closeModal();
      change();
    } else {
      state.common = values.common;
      closeModal();
      change();
    }
  }
  return { submit };
}
