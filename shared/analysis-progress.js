const duration = (ms) =>
  ms >= 60000
    ? `${Math.floor(ms / 60000)}分${Math.floor((ms % 60000) / 1000)}秒`
    : `${(Math.max(0, ms) / 1000).toFixed(1)}秒`;
export function analysisProgress(job, paused = false, now = Date.now()) {
  if (!job) return { label: "等待平台响应", detail: "" };
  const active = ["queued", "running"].includes(job.status);
  const timing = job.timings;
  const end = active ? now : job.finishedAt || timing?.completedAt || now;
  const parts = [];
  if (job.startedAt)
    parts.push(`排队 ${duration(job.startedAt - job.createdAt)}`);
  else if (job.status === "queued")
    parts.push(`已等待 ${duration(now - job.createdAt)}`);
  if (timing) {
    parts.push(
      `图片准备 ${duration((timing.requestStartedAt || end) - timing.attemptStartedAt)}`,
    );
    if (timing.requestStartedAt)
      parts.push(
        `请求至首段 ${duration((timing.firstTokenAt || end) - timing.requestStartedAt)}`,
      );
    if (timing.firstTokenAt)
      parts.push(
        `文本生成 ${duration((timing.completedAt || end) - timing.firstTokenAt)}`,
      );
  }
  let label = "等待平台响应";
  if (job.status === "queued")
    label = paused
      ? "队列已暂停"
      : job.rateLimitUntil > now
        ? "等待平台额度"
        : "等待分析名额";
  else if (job.analysisPhase === "streaming" || job.receivedChars > 0)
    label = "正在编写提示词";
  else if (job.analysisPhase === "preparing") label = "正在准备分析图片";
  return { label, detail: parts.join(" · ") };
}
