import { latestJobs, executionStatus, queueJobWorking } from "./job-status.js";

export const QUEUE_PRODUCT_PAGE_SIZE = 30;
export const latestQueueJobs = (state, productId) =>
  latestJobs(state.jobs, productId);
export const needsQueueReconciliation = (job) =>
  job.mode !== "demo" &&
  !job.remoteId &&
  !!job.stage &&
  !["pending", "completed"].includes(job.stage);

export function retryableQueueJobs(state, jobs = latestQueueJobs(state)) {
  const byId = new Map(state.jobs.map((job) => [job.id, job]));
  const active = new Set();
  const targets = (job) =>
    job.kind === "prompt-set" ? job.taskIds || [] : [job.taskId];
  const key = (job, id) =>
    `${job.productId}:${job.kind === "prompt-set" ? "prompt" : "image"}:${id}`;
  for (const job of jobs) {
    if (!["queued", "running", "interrupted"].includes(job.status)) continue;
    for (const id of targets(job)) active.add(key(job, id));
  }
  return jobs.filter(
    (job) =>
      job.status === "failed" &&
      !needsQueueReconciliation(job) &&
      (!job.dependsOn || byId.get(job.dependsOn)?.status === "completed") &&
      !targets(job).some((id) => active.has(key(job, id))),
  );
}

export function productQueueInfo(
  state,
  product,
  jobs = latestQueueJobs(state, product.id),
) {
  let generated = 0,
    selected = 0,
    picked = 0;
  for (const task of product.tasks) {
    const count = product._summary
      ? task.versionCount || 0
      : task.versions.length;
    const chosen = product._summary
      ? Math.min(count, (task.selectedIds || []).length)
      : task.versions.filter((version) => task.selectedIds.includes(version.id))
          .length;
    if (count) generated++;
    selected += chosen;
    if (chosen) picked++;
  }
  const execution = executionStatus(jobs, state.paused);
  const { label, tone } =
    execution ||
    (picked && picked === product.tasks.length
      ? { label: "已选完成", tone: "done" }
      : generated && !picked
        ? { label: "待选图", tone: "ready" }
        : generated
          ? { label: "部分完成", tone: "partial" }
          : { label: "待开始", tone: "waiting" });
  return { generated, selected, picked, label, tone };
}

// One job index and one product pass per snapshot; no per-product full job scans.
export function queueProgress(state, page = 1, status = "all", search = "") {
  const latest = latestQueueJobs(state);
  const failures = retryableQueueJobs(state, latest);
  const groups = new Map();
  for (const job of latest) {
    if (!groups.has(job.productId)) groups.set(job.productId, []);
    groups.get(job.productId).push(job);
  }
  const retries = new Map();
  for (const job of failures)
    retries.set(job.productId, (retries.get(job.productId) || 0) + 1);
  const summary = {
    products: state.products.length,
    slots: 0,
    generated: 0,
    completeProducts: 0,
    activeProducts: 0,
    attentionProducts: 0,
    selected: 0,
    working: state.jobs.filter(queueJobWorking).length,
    pending: state.jobs.filter(
      (job) => job.status === "queued" && !job.remoteId,
    ).length,
    failed: latest.filter((job) => job.status === "failed").length,
    interrupted: latest.filter((job) => job.status === "interrupted").length,
    retryable: failures.length,
    jobTotal: state.jobTotal ?? state.jobs.length,
    paused: state.paused,
    concurrency: state.concurrency,
  };
  const query = search.trim().toLowerCase();
  const matches = [];
  for (const product of state.products) {
    const jobs = groups.get(product.id) || [];
    const info = productQueueInfo(state, product, jobs);
    summary.slots += product.tasks.length;
    summary.generated += info.generated;
    summary.selected += info.selected;
    const active = jobs.some((job) =>
      ["queued", "running", "interrupted"].includes(job.status),
    );
    const attention = jobs.some((job) =>
      ["failed", "interrupted"].includes(job.status),
    );
    const complete =
      product.tasks.length > 0 && info.generated === product.tasks.length;
    const inProgress = jobs.some((job) =>
      ["queued", "running"].includes(job.status),
    );
    if (complete) summary.completeProducts++;
    if (inProgress) summary.activeProducts++;
    if (attention) summary.attentionProducts++;
    const include =
      status === "all" ||
      (status === "complete" && complete) ||
      (status === "missing" && info.generated === 0) ||
      (status === "partial" &&
        info.generated > 0 &&
        info.generated < product.tasks.length) ||
      (status === "ready" &&
        info.generated > 0 &&
        info.picked < product.tasks.length) ||
      (status === "selected" &&
        info.picked > 0 &&
        info.picked === product.tasks.length) ||
      (status === "active" && inProgress) ||
      (status === "attention" && attention);
    if (
      !include ||
      (query &&
        !`${product.code} ${product.name}`.toLowerCase().includes(query))
    )
      continue;
    matches.push({
      product,
      info,
      active,
      retryable: retries.get(product.id) || 0,
      recovery: jobs.find(
        (job) =>
          job.status === "interrupted" ||
          (job.status === "failed" && needsQueueReconciliation(job)),
      ),
    });
  }
  const total = matches.length;
  const pages = Math.max(1, Math.ceil(total / QUEUE_PRODUCT_PAGE_SIZE));
  page = Math.max(1, Math.min(page, pages));
  return {
    products: matches.slice(
      (page - 1) * QUEUE_PRODUCT_PAGE_SIZE,
      page * QUEUE_PRODUCT_PAGE_SIZE,
    ),
    summary,
    total,
    page,
    pages,
    pageSize: QUEUE_PRODUCT_PAGE_SIZE,
  };
}
