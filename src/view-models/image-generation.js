export function imageGeneration(taskId, jobs, paused = false) {
  const latest = jobs
    .filter((job) => job.kind === "image" && job.taskId === taskId)
    .reduce(
      (last, job) => (!last || job.createdAt >= last.createdAt ? job : last),
      null,
    );
  if (!latest || !["queued", "running"].includes(latest.status)) return null;
  if (latest.remoteId) {
    const value = Number(latest.progress);
    const progress =
      Number.isFinite(value) && value > 0
        ? Math.min(100, Math.max(0, Math.round(value)))
        : null;
    return {
      phase: "generating",
      label: progress === 100 ? "正在保存图片" : "正在生成图片",
      detail: progress === null ? "等待平台返回进度" : "平台实时进度",
      progress,
    };
  }
  if (latest.status === "running")
    return {
      phase: "submitting",
      label: "正在提交图片",
      detail: "正在发送提示词与实拍图",
      progress: null,
    };
  const dependency = jobs.find((job) => job.id === latest.dependsOn);
  if (dependency && ["queued", "running"].includes(dependency.status))
    return {
      phase: "preparing",
      label: "正在准备提示词",
      detail: "提示词就绪后开始生图",
      progress: null,
    };
  return {
    phase: "queued",
    label: paused ? "队列已暂停" : "等待生成",
    detail: paused ? "恢复队列后继续" : "正在排队，即将开始",
    progress: null,
  };
}
