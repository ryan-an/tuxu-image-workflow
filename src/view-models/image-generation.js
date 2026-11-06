export function imageGeneration(taskId, jobs, paused = false) {
  const active = jobs.filter(
    (job) =>
      job.kind === "image" &&
      job.taskId === taskId &&
      ["queued", "running", "interrupted"].includes(job.status),
  );
  const latest = active.reduce(
    (last, job) => (!last || job.createdAt >= last.createdAt ? job : last),
    null,
  );
  if (!latest) return null;
  const info = {
    jobId: latest.id,
    submittedBy:
      latest.createdBy?.displayName || latest.createdBy?.username || "",
  };
  if (latest.status === "interrupted") {
    const pending = latest.mode === "demo" || latest.stage === "pending";
    return {
      ...info,
      phase: "interrupted",
      label: latest.remoteId
        ? "生图已中断"
        : pending
          ? "生图待恢复"
          : "生图待核对",
      detail: latest.remoteId
        ? "已有平台任务，请继续查询结果"
        : pending
          ? "任务尚未提交，可恢复执行"
          : "平台受理状态未知，请先核对",
      progress: null,
      recovery: latest.remoteId
        ? { action: "query-job", label: "继续查询" }
        : pending
          ? { action: "retry-job", label: "恢复任务" }
          : { action: "reconcile-job", label: "核对平台" },
    };
  }
  const running = { ...info, recovery: null };
  if (latest.remoteId) {
    const value = Number(latest.progress);
    const progress =
      Number.isFinite(value) && value > 0
        ? Math.min(100, Math.max(0, Math.round(value)))
        : null;
    return {
      ...running,
      phase: "generating",
      label: progress === 100 ? "正在保存图片" : "正在生成图片",
      detail: progress === null ? "等待平台返回进度" : "平台实时进度",
      progress,
    };
  }
  if (latest.status === "running")
    return {
      ...running,
      phase: "submitting",
      label: "正在提交图片",
      detail: "正在发送提示词与实拍图",
      progress: null,
    };
  const dependency = jobs.find((job) => job.id === latest.dependsOn);
  if (dependency && ["queued", "running"].includes(dependency.status))
    return {
      ...running,
      phase: "preparing",
      label: "正在准备提示词",
      detail: "提示词就绪后开始生图",
      progress: null,
    };
  return {
    ...running,
    phase: "queued",
    label: paused ? "队列已暂停" : "等待生成",
    detail: paused ? "恢复队列后继续" : "正在排队，即将开始",
    progress: null,
  };
}
