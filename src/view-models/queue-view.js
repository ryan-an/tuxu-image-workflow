import { hasSelectedVersion } from "../../shared/model.js";
import { latestJobs, executionStatus } from "../../shared/job-status.js";
export { queueJobWorking } from "../../shared/job-status.js";

export const latestQueueJobs = (state, productId) =>
  latestJobs(state.jobs, productId);
export const needsQueueReconciliation = (job) =>
  job.mode !== "demo" &&
  !job.remoteId &&
  !!job.stage &&
  !["pending", "completed"].includes(job.stage);

export function remainingQueuePairs(state) {
  const activeIds = new Set(
    state.jobs
      .filter((job) =>
        ["queued", "running", "interrupted"].includes(job.status),
      )
      .map((job) => job.taskId)
      .filter(Boolean),
  );
  return state.products.flatMap((product) =>
    product.tasks
      .filter((task) => !task.versions.length && !activeIds.has(task.id))
      .map((task) => ({ product, task })),
  );
}
export function retryableQueueJobs(state) {
  const jobs = latestQueueJobs(state);
  return jobs
    .filter((job) => job.status === "failed" && !needsQueueReconciliation(job))
    .filter(
      (job) =>
        !job.dependsOn ||
        state.jobs.find((parent) => parent.id === job.dependsOn)?.status ===
          "completed",
    )
    .filter(
      (job) =>
        !jobs.some(
          (other) =>
            other.id !== job.id &&
            ["queued", "running", "interrupted"].includes(other.status) &&
            other.productId === job.productId &&
            (job.kind === "prompt-set"
              ? other.kind === "prompt-set" &&
                other.taskIds?.some((id) => job.taskIds?.includes(id))
              : other.taskId === job.taskId),
        ),
    );
}
export function productQueueInfo(state, product) {
  const jobs = latestQueueJobs(state, product.id);
  const generated = product.tasks.filter((task) => task.versions.length).length;
  const history = product.tasks.reduce(
    (n, task) =>
      n + (product._summary ? task.versionCount : task.versions.length),
    0,
  );
  const selected = product.tasks.reduce(
    (n, task) =>
      n + task.versions.filter((v) => task.selectedIds.includes(v.id)).length,
    0,
  );
  const picked = product.tasks.filter(hasSelectedVersion).length;
  let label, tone;
  const execution = executionStatus(jobs, state.paused);
  if (execution) {
    ({ label, tone } = execution);
  } else if (picked === product.tasks.length && picked) {
    label = "已选完成";
    tone = "done";
  } else if (generated && !picked) {
    label = "待选图";
    tone = "ready";
  } else if (generated) {
    label = "部分完成";
    tone = "partial";
  } else {
    label = "待开始";
    tone = "waiting";
  }
  return { generated, history, selected, picked, label, tone };
}
