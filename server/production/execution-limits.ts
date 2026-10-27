export const stageTimeout = (kind: string) =>
  kind === "prompt-set" ? 600000 : 180000;
// Keep claims valid until after the external call's total timeout.
export const leaseDuration = (kind: string) => stageTimeout(kind) + 60000;

export type ExecutionLane = "prompt" | "submit" | "query";
export interface ExecutionLimits {
  imagePreparation: number;
}
export const DEFAULT_EXECUTION_LIMITS: ExecutionLimits = {
  imagePreparation: 2,
};
export function executionLimitsFromEnv(
  env: NodeJS.ProcessEnv,
): ExecutionLimits {
  const profile = env.EXECUTION_PROFILE || "local";
  if (!["local", "small"].includes(profile))
    throw new Error("EXECUTION_PROFILE 须为 local 或 small");
  // Deployment profiles protect local image decoding only. Legacy network
  // concurrency environment variables intentionally have no effect.
  return {
    imagePreparation: profile === "small" ? 1 : 2,
  };
}
export const executionLane = (job: {
  kind: string;
  remoteId?: string;
}): ExecutionLane =>
  job.kind === "prompt-set" ? "prompt" : job.remoteId ? "query" : "submit";
export const modelScope = (job: {
  kind: string;
  config: Record<string, any>;
}) => ({
  provider:
    job.kind === "prompt-set" && job.config.promptProvider === "doubao"
      ? "doubao"
      : `grsai:${job.config.baseUrl || ""}`,
  model: String(
    job.kind === "prompt-set" ? job.config.promptModel : job.config.imageModel,
  ),
});
