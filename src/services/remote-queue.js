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
    await this.repository.refresh({ afterCurrent: true });
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
    await this.repository.refresh({ afterCurrent: true });
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
    this.notify("队列已继续；失败任务可直接重试");
  }
  pump() {
    return this.repository.save();
  }
}
