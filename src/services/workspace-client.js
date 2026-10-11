import {
  editable,
  differences,
  mergeView,
} from "../../shared/workspace-edits.js";
export async function api(path, body, method = body ? "POST" : "GET") {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}
export class WorkspaceClient {
  constructor(state, { render, sync, notify }) {
    this.state = state;
    this.baseline = structuredClone(state);
    Object.assign(this, { render, sync, notify });
    this.chain = Promise.resolve();
  }
  serialize(work) {
    const result = this.chain.catch(() => {}).then(work);
    this.chain = result;
    return result;
  }
  async accept(remote, pending = [], preserveExpected = false) {
    const changes = remote.products.flatMap((p) =>
      p.tasks.map((t) => {
        const old = this.state.products
          .find((v) => v.id === p.id)
          ?.tasks.find((v) => v.id === t.id);
        return {
          productId: p.id,
          taskId: t.id,
          prompt: old?.prompt !== t.prompt,
          reference:
            JSON.stringify(old?.references) !== JSON.stringify(t.references),
          result:
            old?.primaryId !== t.primaryId ||
            old?.versions.length !== t.versions.length,
        };
      }),
    );
    this.baseline = structuredClone(remote);
    if (preserveExpected && pending.length) {
      const reverse = pending
        .filter(
          (e) =>
            !(
              e.path[0] === "products" &&
              e.path.length === 2 &&
              e.before === null
            ),
        )
        .map((e) => ({ ...e, value: e.before }));
      mergeView(this.baseline, remote, reverse);
      for (const edit of pending)
        if (
          edit.path[0] === "products" &&
          edit.path.length === 2 &&
          edit.before === null
        )
          this.baseline.products = this.baseline.products.filter(
            (p) => p.id !== edit.path[1],
          );
    }
    mergeView(this.state, remote, pending);
    for (const change of changes) {
      const p = this.state.products.find((p) => p.id === change.productId),
        t = p?.tasks.find((t) => t.id === change.taskId);
      if (!t) continue;
      try {
        if (change.reference) await this.sync(p, t, "reference");
        if (change.prompt) await this.sync(p, t, "prompt");
        if (change.result) await this.sync(p, t, "result");
      } catch {
        /* Task results remain durable even when the sheet mapping is missing. */
      }
    }
    this.render();
  }
  save() {
    return this.serialize(async () => {
      const sent = editable(this.state),
        edits = differences(editable(this.baseline), sent);
      if (!edits.length) return;
      const remote = await api("/api/workspace", { edits }, "PATCH");
      const pending = differences(sent, editable(this.state));
      await this.accept(remote, pending);
    });
  }
  refresh() {
    return this.serialize(async () => {
      const remote = await api("/api/workspace");
      await this.accept(
        remote,
        differences(editable(this.baseline), editable(this.state)),
        true,
      );
    });
  }
  start() {
    if (typeof EventSource !== "undefined") {
      this.events = new EventSource("/api/analysis/events");
      this.events.onmessage = (message) => {
        const event = JSON.parse(message.data);
        if (event.finished) {
          const job = this.state.jobs.find((job) => job.id === event.id);
          if (
            job &&
            ["failed", "interrupted", "cancelled"].includes(event.status)
          ) {
            job.status = event.status;
            job.error = event.error;
            this.render();
          }
          void this.refresh().catch(() => {});
          return;
        }
        const job = this.state.jobs.find((job) => job.id === event.id);
        if (!job) {
          void this.refresh().catch(() => {});
          return;
        }
        job.promptDrafts = event.drafts;
        job.receivedChars = event.receivedChars;
        this.render();
      };
    }
    const tick = async () => {
      if (this.closed) return;
      try {
        await this.refresh();
        this.errorShown = false;
      } catch (error) {
        if (!this.errorShown) this.notify(`任务状态同步失败：${error.message}`);
        this.errorShown = true;
      }
      if (!this.closed) this.timer = setTimeout(tick, 2500);
    };
    this.timer = setTimeout(tick, 2500);
  }
  stop() {
    this.events?.close();
    this.closed = true;
    clearTimeout(this.timer);
  }
}
