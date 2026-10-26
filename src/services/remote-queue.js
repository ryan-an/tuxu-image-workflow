import { uid } from "../../shared/model.js";
export class RemoteQueue {
  constructor(state, repository, notify) {
    Object.assign(this, { state, repository, notify });
  }
  async enqueue(pairs, kind = "workflow") {
    await this.repository.save();
    const result = await this.repository.request("/api/jobs", {
      commandId: uid(),
      kind,
      pairs: pairs.map(({ product, task }) => ({
        productId: product.id,
        taskId: task.id,
      })),
    });
    await this.repository.refresh();
    return result.count;
  }
  async control(id, action, fields = {}) {
    await this.repository.request(
      `/api/jobs/${encodeURIComponent(id)}/control`,
      {
        commandId: uid(),
        action,
        ...fields,
      },
    );
    await this.repository.refresh();
  }
  cancel(id) {
    return this.control(id, "cancel");
  }
  cancelPending() {
    return this.control("queue", "cancel-pending");
  }
  cancelProduct(productId) {
    return this.control("queue", "cancel-product", { productId });
  }
  retry(id) {
    return this.control(id, "retry");
  }
  pause(paused) {
    return this.control("queue", "pause", { paused });
  }
  async resumeInterrupted() {
    await this.pause(false);
    this.notify("受理状态未知的任务需要逐条核对平台；其他任务由服务端继续执行");
  }
  reconcile(id, fields) {
    return this.control(id, "reconcile", fields);
  }
  pump() {
    return this.repository.save();
  }
}
