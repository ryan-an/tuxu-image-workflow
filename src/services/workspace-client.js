import {
  editable,
  differences,
  mergeView,
} from "../../shared/workspace-edits.js";
import { sessionHeaders, analysisEventsUrl } from "./session-scope.js";
export async function api(
  path,
  body,
  method = body ? "POST" : "GET",
  headers = {},
) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...sessionHeaders(),
      ...headers,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body
      ? {
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (Array.isArray(data.products))
    data.products = data.products.map((product) => {
      if (!product._summary) return product;
      return {
        ...product,
        facts: "",
        photos: product.photo ? [product.photo] : [],
        promptSets: [],
        tasks: product.tasks.map((task) => ({
          ...task,
          references: [],
          prompt: "",
          promptHistory: [],
          revision: 0,
          versions: [
            ...new Set(
              [
                task.primaryId,
                ...task.selectedIds,
                ...(task.versionCount ? ["__summary"] : []),
              ].filter(Boolean),
            ),
          ].map((id) => ({
            id,
            source: "",
            prompt: "",
            number: 0,
            origin: "summary",
            createdAt: 0,
          })),
        })),
      };
    });
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
    this.cursor = state.syncCursor;
    this.productLoads = new Map();
  }
  request(path, body, method = body ? "POST" : "GET", view = {}) {
    const resultHeaders =
      path === "/api/workspace" && method === "PATCH"
        ? { "x-workspace-result": "delta" }
        : {};
    if (!this.state.partial) return api(path, body, method, resultHeaders);
    const ids = this.state.products.filter((p) => !p._summary).map((p) => p.id);
    return api(path, body, method, {
      ...resultHeaders,
      "x-workspace-view": "compact",
      "x-workspace-products":
        view.all || ids.length > 100 ? "all" : JSON.stringify(ids),
      "x-workspace-sheet": (view.sheet ?? this.state.sheetLoaded) ? "1" : "0",
    });
  }
  savedWorkspace(result) {
    if (result.editResult !== "delta") return result;
    const updates = new Map(
      result.products.map((product) => [product.id, product]),
    );
    const products = this.baseline.products.map((product) => {
      const next = updates.get(product.id) || product;
      updates.delete(product.id);
      return next;
    });
    // This acknowledgement only covers our edits, not every entity committed
    // before result.cursor. Keep the old cursor so the next sync cannot skip
    // another editor's changes or a background result.
    return {
      ...this.baseline,
      ...result.document,
      products: [...products, ...updates.values()].sort((a, b) =>
        a.code.localeCompare(b.code),
      ),
    };
  }
  loadProducts(ids) {
    const missing = [...new Set(ids)].filter(
      (id) => this.state.products.find((p) => p.id === id)?._summary,
    );
    if (!missing.length) return Promise.resolve();
    const key = missing.sort().join(",");
    if (this.productLoads.has(key)) return this.productLoads.get(key);
    const work = this.serialize(async () => {
      this.capture();
      const result = await this.request(
        `/api/workspace/products?ids=${encodeURIComponent(key)}`,
      );
      this.capture();
      const pending = differences(
        editable(this.baseline),
        editable(this.state),
      );
      const updates = new Map(result.products.map((p) => [p.id, p]));
      // A detail read does not cover changes to other products, so it must not
      // advance the workspace cursor. The next delta may safely replay it.
      await this.accept(
        {
          ...this.baseline,
          products: this.baseline.products.map((p) => updates.get(p.id) || p),
          jobs: result.jobs
            ? [
                ...this.baseline.jobs.filter(
                  (job) => !updates.has(job.productId),
                ),
                ...result.jobs,
              ].sort(
                (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
              )
            : this.baseline.jobs,
        },
        pending,
        true,
        new Set(),
      );
    }).finally(() => this.productLoads.delete(key));
    this.productLoads.set(key, work);
    return work;
  }
  loadSheet() {
    if (!this.state.partial || this.state.sheetLoaded) return Promise.resolve();
    if (this.sheetLoading) return this.sheetLoading;
    this.sheetLoading = this.serialize(async () => {
      const { sheetSnapshot } = await this.request("/api/workspace/sheet");
      this.state.sheetSnapshot = structuredClone(sheetSnapshot);
      this.baseline.sheetSnapshot = structuredClone(sheetSnapshot);
      this.state.sheetLoaded = this.baseline.sheetLoaded = true;
      await this.syncSheet(null);
      this.render();
    }).finally(() => {
      this.sheetLoading = null;
    });
    return this.sheetLoading;
  }
  loadAll() {
    if (
      !this.state.partial ||
      (this.state.sheetLoaded && this.state.products.every((p) => !p._summary))
    )
      return Promise.resolve();
    if (this.allLoading) return this.allLoading;
    this.allLoading = this.serialize(async () => {
      this.capture();
      const remote = await this.request("/api/workspace", undefined, "GET", {
        all: true,
        sheet: true,
      });
      this.capture();
      await this.accept(
        remote,
        differences(editable(this.baseline), editable(this.state)),
        true,
        new Set(),
      );
      this.cursor = remote.syncCursor;
    }).finally(() => {
      this.allLoading = null;
    });
    return this.allLoading;
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
      .filter(
        (p) =>
          !p._summary &&
          !oldProducts.get(p.id)?._summary &&
          (!changedIds || changedIds.has(p.id)),
      )
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
    if (this.state.sheetLoaded !== false) await this.syncSheet(previousSheet);
    const changed = changes.filter(
      (change) => change.reference || change.prompt || change.result,
    );
    if (changed.length && this.state.sheetLoaded !== false)
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
      const remote = this.savedWorkspace(
        await this.request("/api/workspace", { edits }, "PATCH"),
      );
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
      const remote = this.savedWorkspace(
        await this.request("/api/workspace", { edits }, "PATCH"),
      );
      this.capture();
      const pending = differences(before, editable(this.state));
      await this.accept(remote, pending, true);
    });
  }
  deleteProduct(id) {
    return this.serialize(async () => {
      this.capture();
      const before = editable(this.state);
      const remote = await this.request(
        `/api/products/${encodeURIComponent(id)}`,
        undefined,
        "DELETE",
      );
      this.capture();
      const pending = differences(before, editable(this.state)).filter(
        (edit) =>
          edit.path[0] !== "sheetSnapshot" &&
          !(edit.path[0] === "products" && edit.path[1] === id),
      );
      await this.accept(remote, pending);
    });
  }
  refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.serialize(async () => {
      this.capture();
      let remote,
        changedIds = null;
      if (this.cursor === undefined) this.cursor = this.state.syncCursor;
      if (this.cursor === undefined)
        remote = await this.request("/api/workspace");
      else {
        const delta = await this.request(
          `/api/workspace/changes?since=${this.cursor}`,
        );
        if (delta.reset) remote = await this.request("/api/workspace");
        else {
          if (
            !delta.products.length &&
            !delta.jobs.length &&
            !delta.document &&
            !delta.deletedProducts.length &&
            !delta.deletedJobs.length &&
            (delta.jobTotal === undefined ||
              delta.jobTotal === this.baseline.jobTotal)
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
            ...(delta.jobTotal !== undefined
              ? { jobTotal: delta.jobTotal }
              : {}),
            syncCursor: delta.cursor,
            products: merge(
              this.baseline.products,
              delta.products,
              delta.deletedProducts,
            ).sort((a, b) => a.code.localeCompare(b.code)),
            jobs: delta.replaceJobs
              ? delta.jobs
              : merge(this.baseline.jobs, delta.jobs, delta.deletedJobs),
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
  reload({ acceptRemoteSheet = false } = {}) {
    return this.serialize(async () => {
      const remote = await api("/api/workspace");
      await this.accept(
        remote,
        differences(editable(this.baseline), editable(this.state)).filter(
          (edit) => !acceptRemoteSheet || edit.path[0] !== "sheetSnapshot",
        ),
      );
      this.cursor = remote.syncCursor;
    });
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
        if (event.drafts !== undefined) job.promptDrafts = event.drafts;
        if (event.receivedChars !== undefined)
          job.receivedChars = event.receivedChars;
        if (event.analysisPhase !== undefined)
          job.analysisPhase = event.analysisPhase;
        if (event.timings !== undefined) job.timings = event.timings;
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
