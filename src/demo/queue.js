import { uid, findTask, addVersion, savePrompt } from "../../shared/model.js";
import { runDemo } from "./demo-images.js";
import {
  demoSuite,
  productPhotos,
  productRequirements,
} from "../../shared/prompt-suite.js";
const active = (j) => ["queued", "running", "interrupted"].includes(j.status);
export class GenerationQueue {
  constructor(state, { change, sync, notify, persist = async () => {} }) {
    Object.assign(this, { state, change, sync, notify, persist });
    this.controllers = new Map();
  }
  newJob(product, kind, fields = {}) {
    const job = {
      id: uid(),
      productId: product.id,
      productName: product.name,
      kind,
      status: "queued",
      createdAt: Date.now(),
      mode: this.state.settings.mode,
      config: { ...this.state.settings },
      error: "",
      ...fields,
    };
    this.state.jobs.push(job);
    return job;
  }
  setJob(product, tasks) {
    const activeSets = this.state.jobs.filter(
      (j) =>
        j.productId === product.id &&
        j.kind === "prompt-set" &&
        ["queued", "running"].includes(j.status),
    );
    const existing = activeSets.find((j) =>
      tasks.every((t) => j.taskIds?.includes(t.id)),
    );
    if (existing) return existing;
    if (activeSets.some((j) => tasks.some((t) => j.taskIds?.includes(t.id))))
      throw new Error("所选卡片已有分析任务，请等待完成后重试");
    const snapshot = structuredClone(product);
    snapshot.tasks = snapshot.tasks.filter((t) =>
      tasks.some((target) => target.id === t.id),
    );
    return this.newJob(product, "prompt-set", {
      role:
        tasks.length === 10
          ? "整套 10 张提示词"
          : `${tasks.map((t) => t.role).join("、")}提示词`,
      taskIds: tasks.map((t) => t.id),
      revisions: Object.fromEntries(tasks.map((t) => [t.id, t.revision])),
      productSnapshot: snapshot,
      common: productRequirements(product, this.state.common),
    });
  }
  enqueue(pairs, kind = "workflow") {
    const before = this.state.jobs.length;
    const groups = new Map();
    for (const pair of pairs) {
      if (!groups.has(pair.product.id))
        groups.set(pair.product.id, { product: pair.product, tasks: [] });
      if (!groups.get(pair.product.id).tasks.includes(pair.task))
        groups.get(pair.product.id).tasks.push(pair.task);
    }
    if (this.state.settings.mode === "live")
      for (const { product } of groups.values()) {
        if (!productPhotos(product).length)
          throw new Error(`${product.name}：请先上传实拍图`);
      }
    for (const { product, tasks } of groups.values()) {
      if (["prompt", "prompt-set"].includes(kind)) {
        this.setJob(product, tasks);
        continue;
      }
      const set =
        kind === "full-workflow" ||
        (kind === "workflow" && tasks.some((t) => !t.prompt.trim()))
          ? this.setJob(product, tasks)
          : undefined;
      for (const task of tasks) {
        if (this.state.jobs.some((j) => j.taskId === task.id && active(j)))
          continue;
        const photos = productPhotos(product);
        const indices = task.realPhotoIndices;
        this.newJob(product, "image", {
          taskId: task.id,
          role: task.role,
          prompt: task.prompt,
          revision: task.revision,
          referenceImages: indices?.length
            ? indices.map((i) => photos[i]).filter(Boolean)
            : photos,
          dependsOn: set?.id,
        });
      }
    }
    this.change();
    void this.persist().then(() => this.pump());
    return this.state.jobs.length - before;
  }
  pump() {
    if (this.state.paused) return;
    const lane = (job) =>
      job.kind === "prompt-set" ? "prompt" : job.remoteId ? "query" : "submit";
    const limits = {
      prompt: this.state.promptConcurrency ?? 15,
      submit: this.state.concurrency,
      query: this.state.queryConcurrency ?? 8,
    };
    const free = Object.fromEntries(
      Object.entries(limits).map(([kind, limit]) => [
        kind,
        limit -
          this.state.jobs.filter(
            (j) => j.status === "running" && lane(j) === kind,
          ).length,
      ]),
    );
    let updated = false;
    for (const job of this.state.jobs.filter((j) => j.status === "queued")) {
      const dependency =
        job.dependsOn && this.state.jobs.find((j) => j.id === job.dependsOn);
      if (
        (job.dependsOn && !dependency) ||
        (dependency &&
          ["failed", "cancelled", "interrupted"].includes(dependency.status))
      ) {
        job.status = "failed";
        job.error = "整套提示词未完成，请先重试整套提示词任务";
        updated = true;
        continue;
      }
      if (dependency && dependency.status !== "completed") continue;
      if (free[lane(job)] > 0) {
        free[lane(job)]--;
        void this.run(job);
      }
    }
    if (updated) this.change();
  }
  async request(job, path, body, signal) {
    const response = await fetch(`/api/workflow/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({ ...body, config: job.config }),
    });
    const data = await response.json();
    if (data.id && data.id !== job.remoteId) {
      job.remoteId = data.id;
      this.change();
      await this.persist();
    }
    if (!response.ok) throw new Error(data.error || "平台请求失败");
    return data;
  }
  async image(job, product, task, signal) {
    if (job.mode === "demo")
      return runDemo(
        product,
        task,
        "image",
        productRequirements(product, this.state.common),
        signal,
      );
    if (!job.referenceImages?.length)
      throw new Error("缺少产品实拍图，请上传后重试");
    let data = job.remoteId
      ? await this.request(job, "result", { id: job.remoteId }, signal)
      : await this.request(
          job,
          "image",
          { prompt: job.prompt, referenceImages: job.referenceImages },
          signal,
        );
    while (data.status !== "succeeded") {
      job.progress = data.progress || 0;
      this.change();
      await new Promise((resolve, reject) => {
        if (signal.aborted)
          return reject(new DOMException("Cancelled", "AbortError"));
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException("Cancelled", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, 2500);
        signal.addEventListener("abort", abort, { once: true });
      });
      data = await this.request(job, "result", { id: job.remoteId }, signal);
    }
    if (!data.image?.startsWith("data:image/"))
      throw new Error("平台未返回可保存的图片");
    return data.image;
  }
  async run(job) {
    const { product, task } = findTask(this.state, job.productId, job.taskId);
    if (!product || (job.kind !== "prompt-set" && !task)) {
      job.status = "cancelled";
      this.change();
      return;
    }
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    job.status = "running";
    job.startedAt = Date.now();
    job.stage = job.kind === "prompt-set" ? "prompt" : "image";
    this.change();
    try {
      if (job.kind === "prompt-set") {
        const targets = product.tasks.filter(
          (t) => !job.taskIds || job.taskIds.includes(t.id),
        );
        const result =
          job.mode === "demo"
            ? demoSuite(job.productSnapshot, job.common)
            : await this.request(
                job,
                "prompt-set",
                { product: job.productSnapshot, common: job.common },
                controller.signal,
              );
        if (controller.signal.aborted)
          throw new DOMException("Cancelled", "AbortError");
        if (
          !Array.isArray(result.prompts) ||
          result.prompts.length !== targets.length ||
          targets.some(
            (t) => !result.prompts.some((p) => p.role === t.role && p.prompt),
          )
        )
          throw new Error("没有收到所选卡片的完整提示词，请重试分析");
        job.prompts = result.prompts;
        const set = {
          id: job.id,
          createdAt: Date.now(),
          style: result.style,
          prompts: structuredClone(result.prompts),
        };
        (product.promptSets ||= []).push(set);
        for (const t of targets) {
          const item = result.prompts.find((p) => p.role === t.role);
          if (t.revision === job.revisions[t.id]) {
            savePrompt(t, item.prompt);
            t.promptSetId = job.id;
            t.realPhotoIndices = item.photoIndices;
          } else {
            t.promptHistory.push({
              prompt: item.prompt,
              createdAt: set.createdAt,
              setId: job.id,
            });
            this.notify(`${t.role}执行期间有修改，整套新提示词已放入历史`);
          }
        }
        for (const t of targets) {
          try {
            await this.sync(product, t, "prompt");
          } catch (error) {
            job.syncError = error.message;
          }
        }
      } else {
        const set =
          job.dependsOn && this.state.jobs.find((j) => j.id === job.dependsOn);
        if (set) {
          const item = set.prompts.find((p) => p.role === task.role);
          job.prompt = item.prompt;
          const photos = productPhotos(set.productSnapshot);
          job.referenceImages = item.photoIndices?.length
            ? item.photoIndices.map((i) => photos[i]).filter(Boolean)
            : photos;
        }
        if (!job.prompt) throw new Error("请先生成整套提示词");
        const source = await this.image(job, product, task, controller.signal);
        if (controller.signal.aborted)
          throw new DOMException("Cancelled", "AbortError");
        addVersion(
          task,
          source,
          job.prompt,
          job.mode === "demo" ? "demo" : "generated",
        );
        try {
          await this.sync(product, task, "result");
        } catch (error) {
          job.syncError = error.message;
        }
      }
      job.status = "completed";
    } catch (error) {
      job.status = controller.signal.aborted ? "cancelled" : "failed";
      job.error = controller.signal.aborted ? "已取消" : error.message;
    } finally {
      job.finishedAt = Date.now();
      this.controllers.delete(job.id);
      this.change();
      // Set results must be durable before their image jobs proceed. Individual
      // results use the app's throttled autosave rather than hundreds of full saves.
      if (job.kind === "prompt-set") await this.persist();
      this.pump();
      if (
        !this.state.jobs.some((j) => ["queued", "running"].includes(j.status))
      )
        await this.persist();
    }
  }
  cancel(id) {
    const job = this.state.jobs.find((j) => j.id === id);
    if (!job || !active(job)) return;
    this.controllers.get(id)?.abort();
    job.status = "cancelled";
    job.finishedAt = Date.now();
    job.error = "已取消";
    for (const child of this.state.jobs.filter(
      (j) => j.dependsOn === id && j.status === "queued",
    )) {
      child.status = "cancelled";
      child.finishedAt = Date.now();
      child.error = "上游分析已终止，本任务已取消";
    }
    this.change();
    this.pump();
  }
  cancelMatching(predicate) {
    const paused = this.state.paused;
    this.state.paused = true;
    try {
      for (const job of this.state.jobs.filter(predicate)) this.cancel(job.id);
    } finally {
      this.state.paused = paused;
      this.change();
      this.pump();
    }
  }
  cancelPending() {
    this.cancelMatching((job) => job.status === "queued" && !job.remoteId);
  }
  cancelProduct(productId) {
    this.cancelMatching((job) => job.productId === productId && active(job));
  }
  retry(id) {
    const job = this.state.jobs.find((j) => j.id === id);
    if (!job || !["failed", "cancelled", "interrupted"].includes(job.status))
      return;
    const pair = findTask(this.state, job.productId, job.taskId);
    if (job.kind === "prompt-set") {
      if (!pair.product) return;
      if (
        this.state.jobs.some(
          (j) =>
            j.id !== id &&
            j.productId === job.productId &&
            j.kind === "prompt-set" &&
            j.taskIds?.some((taskId) => job.taskIds?.includes(taskId)) &&
            active(j),
        )
      )
        return;
      job.productSnapshot = structuredClone(pair.product);
      job.productSnapshot.tasks = job.productSnapshot.tasks.filter(
        (t) => !job.taskIds || job.taskIds.includes(t.id),
      );
      job.revisions = Object.fromEntries(
        job.productSnapshot.tasks.map((t) => [t.id, t.revision]),
      );
      job.common = productRequirements(pair.product, this.state.common);
      job.status = "queued";
      job.error = "";
      for (const child of this.state.jobs.filter(
        (j) => j.dependsOn === id && j.status === "failed",
      )) {
        if (
          this.state.jobs.some(
            (other) =>
              other.id !== child.id &&
              other.taskId === child.taskId &&
              active(other),
          )
        )
          continue;
        child.status = "queued";
        child.error = "";
      }
      this.change();
      void this.persist().then(() => this.pump());
    } else if (pair.task) {
      if (
        this.state.jobs.some(
          (other) =>
            other.id !== id && other.taskId === job.taskId && active(other),
        )
      )
        return;
      if (job.remoteId) {
        job.status = "queued";
        job.error = "";
        this.change();
        void this.persist().then(() => this.pump());
        return;
      }
      const previousStatus = job.status;
      job.status = "cancelled";
      let enqueued = false;
      try {
        enqueued =
          this.enqueue(
            [pair],
            job.kind === "prompt"
              ? "prompt"
              : job.dependsOn && !pair.task.prompt
                ? "workflow"
                : "image",
          ) > 0;
      } finally {
        job.status =
          enqueued && previousStatus === "interrupted"
            ? "cancelled"
            : previousStatus;
      }
    }
  }
  pause(paused) {
    this.state.paused = paused;
    this.change();
    if (!paused) this.pump();
  }
  resumeInterrupted() {
    for (const job of this.state.jobs)
      if (job.status === "interrupted") job.status = "queued";
    this.pause(false);
  }
}
