export const missingImageResultMessage = (message = "") =>
  /\bresult\s+(?:not\s+exist|does\s+not\s+exist|not\s+found)\b/i.test(message);

export const unavailableImageResult = (job) =>
  job?.kind === "image" &&
  !!job.remoteId &&
  (job.resultUnavailable === true ||
    missingImageResultMessage(job.error) ||
    /错误码[：:]\s*-22\b/.test(job.error || ""));
