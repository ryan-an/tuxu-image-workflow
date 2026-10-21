export function latestJobs(jobs, productId) {
  const latest = new Map();
  for (const job of jobs) {
    if (productId && job.productId !== productId) continue;
    const targets =
      job.kind === "prompt-set"
        ? job.taskIds || [job.id]
        : [job.taskId || job.id];
    for (const target of targets) {
      const key = `${job.productId}:${job.kind === "prompt-set" ? "prompt" : "image"}:${target}`;
      const previous = latest.get(key);
      if (!previous || job.createdAt >= previous.createdAt)
        latest.set(key, job);
    }
  }
  // Active work remains visible even when a newer attempt covers its position.
  return [
    ...new Set([
      ...latest.values(),
      ...jobs.filter(
        (job) =>
          (!productId || job.productId === productId) &&
          ["queued", "running", "interrupted"].includes(job.status),
      ),
    ]),
  ];
}

export const queueJobWorking = (job) =>
  job.status === "running" || (job.status === "queued" && !!job.remoteId);
export function executionStatus(jobs, paused = false) {
  if (jobs.some(queueJobWorking))
    return {
      label: jobs.some(
        (job) => queueJobWorking(job) && job.kind === "prompt-set",
      )
        ? "分析中"
        : "生成中",
      tone: "working",
      busy: true,
    };
  if (jobs.some((job) => job.status === "failed"))
    return { label: "待重试", tone: "error", busy: false };
  if (jobs.some((job) => job.status === "interrupted"))
    return { label: "待恢复", tone: "waiting", busy: false };
  if (jobs.some((job) => job.status === "queued"))
    return { label: paused ? "已暂停" : "排队中", tone: "waiting", busy: true };
}
