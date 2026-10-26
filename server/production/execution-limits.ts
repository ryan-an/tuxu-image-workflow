export const stageTimeout = (kind: string) =>
  kind === "prompt-set" ? 600000 : 180000;
// Keep claims valid until after the external call's total timeout.
export const leaseDuration = (kind: string) => stageTimeout(kind) + 60000;

export type ExecutionLane = "prompt" | "submit" | "query";
export interface ExecutionLimits {
  prompt: number;
  submit: number;
  query: number;
  imagePreparation: number;
}
export const DEFAULT_EXECUTION_LIMITS: ExecutionLimits = {
  prompt: 15,
  submit: 6,
  query: 8,
  imagePreparation: 2,
};
export function executionLimitsFromEnv(
  env: NodeJS.ProcessEnv,
): ExecutionLimits {
  const profile = env.EXECUTION_PROFILE || "local";
  if (!["local", "small"].includes(profile))
    throw new Error("EXECUTION_PROFILE 须为 local 或 small");
  const defaults =
    profile === "small"
      ? { prompt: 5, submit: 2, query: 4, imagePreparation: 1 }
      : DEFAULT_EXECUTION_LIMITS;
  const value = (name: string, fallback: number, maximum: number) => {
    if (!env[name]) return fallback;
    const parsed = Number(env[name]);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum)
      throw new Error(`${name} 须为 1～${maximum} 的整数`);
    return parsed;
  };
  return {
    prompt: value("PROMPT_CONCURRENCY_LIMIT", defaults.prompt, 30),
    submit: value("IMAGE_SUBMIT_CONCURRENCY_LIMIT", defaults.submit, 30),
    query: value("IMAGE_QUERY_CONCURRENCY_LIMIT", defaults.query, 32),
    imagePreparation: defaults.imagePreparation,
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
