import { chosen } from "./model.js";

export function latestQueueJobs(state, productId) {
  const latest = new Map();
  for (const job of state.jobs) {
    if (productId && job.productId !== productId) continue;
    latest.set(
      `${job.productId}:${job.kind === "prompt-set" ? "set" : job.taskId || job.id}`,
      job,
    );
  }
  return [...latest.values()];
}
export function retryableQueueJobs(state) {
  const failed = latestQueueJobs(state).filter(
    (job) => job.status === "failed",
  );
  const ids = new Set(failed.map((job) => job.id));
  return failed.filter((job) => !job.dependsOn || !ids.has(job.dependsOn));
}
export function productQueueInfo(state, product) {
  const jobs = latestQueueJobs(state, product.id);
  const generated = product.tasks.filter((task) => task.versions.length).length;
  const history = product.tasks.reduce(
    (n, task) => n + task.versions.length,
    0,
  );
  const selected = product.tasks.reduce(
    (n, task) =>
      n + task.versions.filter((v) => task.selectedIds.includes(v.id)).length,
    0,
  );
  const picked = product.tasks.filter((task) => chosen(task)).length;
  let label, tone;
  if (jobs.some((j) => j.status === "running")) {
    label = jobs.some((j) => j.status === "running" && j.kind === "prompt-set")
      ? "分析中"
      : "生成中";
    tone = "working";
  } else if (jobs.some((j) => j.status === "failed")) {
    label = "待重试";
    tone = "error";
  } else if (jobs.some((j) => j.status === "interrupted")) {
    label = "待恢复";
    tone = "waiting";
  } else if (jobs.some((j) => j.status === "queued")) {
    label = state.paused ? "已暂停" : "排队中";
    tone = "waiting";
  } else if (picked === product.tasks.length && picked) {
    label = "已选完成";
    tone = "done";
  } else if (generated === product.tasks.length && generated) {
    label = "待选图";
    tone = "ready";
  } else if (generated) {
    label = "部分完成";
    tone = "ready";
  } else {
    label = "待开始";
    tone = "waiting";
  }
  return { generated, history, selected, picked, label, tone };
}
