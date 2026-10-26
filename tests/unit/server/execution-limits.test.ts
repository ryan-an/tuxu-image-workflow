import test from "node:test";
import assert from "node:assert/strict";
import { executionLimitsFromEnv } from "../../../server/production/execution-limits.js";
import { analysisProgress } from "../../../shared/analysis-progress.js";
test("local and small deployment profiles have separate configurable server caps", () => {
  assert.deepEqual(executionLimitsFromEnv({}), {
    prompt: 15,
    submit: 6,
    query: 8,
    imagePreparation: 2,
  });
  assert.deepEqual(executionLimitsFromEnv({ EXECUTION_PROFILE: "small" }), {
    prompt: 5,
    submit: 2,
    query: 4,
    imagePreparation: 1,
  });
  assert.equal(
    executionLimitsFromEnv({
      EXECUTION_PROFILE: "small",
      PROMPT_CONCURRENCY_LIMIT: "15",
    }).prompt,
    15,
  );
  assert.throws(() =>
    executionLimitsFromEnv({ PROMPT_CONCURRENCY_LIMIT: "0" }),
  );
  assert.throws(() => executionLimitsFromEnv({ EXECUTION_PROFILE: "invalid" }));
});
test("analysis progress distinguishes queue, image preparation, first output and generation durations", () => {
  const job = {
    createdAt: 1000,
    startedAt: 3000,
    status: "running",
    analysisPhase: "requesting",
    timings: { attemptStartedAt: 3000, requestStartedAt: 5000 },
  };
  const preparing = analysisProgress(
    { ...job, analysisPhase: "preparing", timings: { attemptStartedAt: 3000 } },
    false,
    4000,
  );
  assert.equal(preparing.label, "正在准备分析图片");
  const waiting = analysisProgress(job, false, 8000);
  assert.match(waiting.detail, /排队 2.0秒.*图片准备 2.0秒.*请求至首段 3.0秒/);
  const finished = analysisProgress(
    {
      ...job,
      status: "completed",
      finishedAt: 13000,
      timings: { ...job.timings, firstTokenAt: 8000, completedAt: 13000 },
    },
    false,
    90000,
  );
  assert.match(finished.detail, /文本生成 5.0秒/);
  assert.equal(
    analysisProgress(
      { status: "queued", createdAt: 1000, rateLimitUntil: 10000 },
      false,
      5000,
    ).label,
    "等待平台额度",
  );
});
