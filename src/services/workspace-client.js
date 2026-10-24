import {
  editable,
  differences,
  mergeView,
} from "../../shared/workspace-edits.js";
import { sessionHeaders, analysisEventsUrl } from "./session-scope.js";
export async function api(path, body, method = body ? "POST" : "GET") {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...sessionHeaders(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body
      ? {
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (response.status === 401 && typeof window !== "undefined")
    window.dispatchEvent(new Event("tuxu:authentication-required"));
  if (!response.ok)
    throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}
export class WorkspaceClient {
  constructor(
    state,
    {
      render,
      sync,
      notify,
      syncBatch = (work) => work(),
      capture = () => {},
      syncSheet = () => {},
    },
  ) {
    this.state = state;
    this.baseline = structuredClone(state);
    Object.assign(this, {
      render,
      sync,
      notify,
      syncBatch,
      capture,
      syncSheet,
    });
    this.chain = Promise.resolve();
  }
  serialize(work) {
    const result = this.chain.catch(() => {}).then(work);
    this.chain = result;
    return result;
  }
  async accept(
    remote,
    pending = [],
    preserveExpected = false,
    changedIds = null,
  ) {
    const previousSheet = structuredClone(this.state.sheetSnapshot);
    const oldProducts = new Map(this.state.products.map((p) => [p.id, p]));
    const changes = remote.products
      .filter((p) => !changedIds || changedIds.has(p.id))
      .flatMap((p) =>
        p.tasks.map((t) => {
          const old = oldProducts.get(p.id)?.tasks.find((v) => v.id === t.id);
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
    await this.syncSheet(previousSheet);
    const changed = changes.filter(
      (change) => change.reference || change.prompt || change.result,
    );
    if (changed.length)
      await this.syncBatch(async () => {
        for (const change of changed) {
          const p = this.state.products.find((p) => p.id === change.productId),
            t = p?.tasks.find((t) => t.id === change.taskId);
          if (!t) continue;
          try {
            if (change.reference) await this.sync(p, t, "reference");
            if (change.prompt) await this.sync(p, t, "prompt");
            if (change.result) await this.sync(p, t, "result");
          } catch (error) {
            this.notify(`生成结果已保存，但表格回填失败：${error.message}`);
          }
        }
      });
    this.render();
  }
  save() {
    return this.serialize(async () => {
      this.capture();
      const sent = structuredClone(editable(this.state)),
        edits = differences(editable(this.baseline), sent);
      if (!edits.length) return;
      const remote = await api("/api/workspace", { edits }, "PATCH");
      this.capture();
      const pending = differences(sent, editable(this.state));
      await this.accept(remote, pending);
    });
  }
  // Commit a dialog's frozen before-value without replacing other local edits.
  edit(edits) {
    return this.serialize(async () => {
      this.capture();
      const before = structuredClone(editable(this.baseline));
      const remote = await api("/api/workspace", { edits }, "PATCH");
      this.capture();
      const pending = differences(before, editable(this.state));
      await this.accept(remote, pending, true);
    });
  }
  refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.serialize(async () => {
      this.capture();
      let remote,
        changedIds = null;
      if (this.cursor === undefined) this.cursor = this.state.syncCursor;
      if (this.cursor === undefined) remote = await api("/api/workspace");
      else {
        const delta = await api(`/api/workspace/changes?since=${this.cursor}`);
        if (delta.reset) remote = await api("/api/workspace");
        else {
          if (
            !delta.products.length &&
            !delta.jobs.length &&
            !delta.document &&
            !delta.deletedProducts.length &&
            !delta.deletedJobs.length
          ) {
            this.cursor = delta.cursor;
            return;
          }
          const merge = (items, changed, deleted) => {
            const updates = new Map(changed.map((item) => [item.id, item]));
            const removed = new Set(deleted);
            const result = items
              .filter((item) => !removed.has(item.id))
              .map((item) => {
                const next = updates.get(item.id) || item;
                updates.delete(item.id);
                return next;
              });
            return [...result, ...updates.values()];
          };
          changedIds = new Set(delta.products.map((p) => p.id));
          remote = {
            ...this.baseline,
            ...delta.document,
            syncCursor: delta.cursor,
            products: merge(
              this.baseline.products,
              delta.products,
              delta.deletedProducts,
            ).sort((a, b) => a.code.localeCompare(b.code)),
            jobs: merge(this.baseline.jobs, delta.jobs, delta.deletedJobs),
          };
        }
      }
      this.capture();
      await this.accept(
        remote,
        differences(editable(this.baseline), editable(this.state)),
        true,
        changedIds,
      );
      this.cursor = remote.syncCursor;
    }).finally(() => {
      this.refreshing = null;
      this.scheduleRefresh();
    });
    return this.refreshing;
  }
  start() {
    if (this.started) return;
    this.started = true;
    this.closed = false;
    this.onVisibilityChange = () => {
      clearTimeout(this.timer);
      if (!document.hidden) void this.poll();
    };
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    if (typeof EventSource !== "undefined") {
      this.events = new EventSource(analysisEventsUrl());
      this.events.onmessage = (message) => {
        if (this.closed || this.isHidden()) return;
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
    this.scheduleRefresh();
  }
  isHidden() {
    return typeof document !== "undefined" && document.hidden;
  }
  scheduleRefresh() {
    clearTimeout(this.timer);
    if (!this.started || this.closed || this.isHidden() || this.refreshing)
      return;
    const active = this.state.jobs.some(
      (job) => job.status === "queued" || job.status === "running",
    );
    this.timer = setTimeout(() => void this.poll(), active ? 2500 : 20000);
  }
  async poll() {
    if (this.closed || this.isHidden()) return;
    try {
      await this.refresh();
      this.errorShown = false;
    } catch (error) {
      if (!this.errorShown) this.notify(`任务状态同步失败：${error.message}`);
      this.errorShown = true;
    }
  }
  stop() {
    this.events?.close();
    this.closed = true;
    this.started = false;
    clearTimeout(this.timer);
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }
}
