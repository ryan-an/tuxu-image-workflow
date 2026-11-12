import test from "node:test";
import assert from "node:assert/strict";
import { platformFailure } from "../../../server/production/provider-errors.js";

const options = {
  label: "生图模型调用失败",
  key: "test-secret",
  status: 200,
  grsai: true,
};

test("documented Grsai failure reasons have actionable Chinese and retain raw details and IDs", () => {
  for (const [code, expected] of [
    ["input_moderation", /提示词或参考图片未通过平台审核/],
    ["output_moderation", /生成的图片未通过平台审核/],
    ["error", /平台生成失败/],
  ] as const) {
    const result = platformFailure(
      {
        status: "failed",
        failure_reason: code,
        error: "upstream detail test-secret",
      },
      { ...options, taskId: "task-1", requestId: "req-1" },
    );
    assert.match(result.message, expected);
    assert.match(result.message, /平台原始信息：upstream detail \[已隐藏\]/);
    assert.ok(result.message.includes(code));
    assert.match(result.message, /请求 ID：req-1.*任务 ID：task-1/);
    assert.doesNotMatch(result.message, /test-secret/);
  }
});

test("HTTP errors are explained without exposing proxy HTML or confusing 413 with a per-file limit", () => {
  for (const [status, expected] of [
    [400, /参数/],
    [401, /API Key/],
    [403, /权限/],
    [404, /接口或任务/],
    [408, /超时/],
    [413, /数据总量超过服务限制/],
    [415, /格式/],
    [422, /参数/],
    [429, /频繁或暂时繁忙/],
    [500, /内部错误/],
    [502, /网关或上游/],
    [503, /暂时不可用/],
    [504, /超时/],
  ] as const) {
    const result = platformFailure({}, { ...options, status });
    assert.match(result.message, expected);
    assert.ok(result.message.includes(`HTTP ${status}`));
    assert.doesNotMatch(result.message, /单张.*超过 6MB|余额不足/);
  }
});

test("known raw messages translate and unknown failures remain factual without changing Doubao", () => {
  for (const [error, expected] of [
    ["generate failed", /平台未能生成图片/],
    ["generate image failed", /平台未能生成图片/],
    ["server_timeout", /平台生图处理超时/],
    ["Invalid input parameters", /生图参数不符合平台要求/],
  ] as const)
    assert.match(
      platformFailure({ status: "failed", error }, options).message,
      expected,
    );
  for (const error of ["unknown_vendor_error", "__proto__", "constructor"])
    assert.equal(
      platformFailure({ status: "failed", error }, options).message,
      `生图模型调用失败：${error}`,
    );
  assert.match(
    platformFailure({ status: "violation" }, options).message,
    /未通过平台审核/,
  );
  assert.match(
    platformFailure({ code: -22, msg: "not found" }, options).message,
    /找不到该任务.*查询有效期/,
  );
  assert.equal(
    platformFailure({ error: "余额不足，请充值" }, { ...options, status: 400 })
      .message,
    "生图模型调用失败：余额不足，请充值（HTTP 400）",
  );
  const doubao = platformFailure(
    {},
    { ...options, grsai: false, doubao: true, status: 413 },
  );
  assert.match(doubao.message, /平台未提供具体失败原因/);
});

test("a missing result is distinguished from a missing endpoint without asserting expiry", () => {
  for (const status of [200, 404]) {
    const result = platformFailure(
      { error: "result not exist, valid for 2 hours" },
      { ...options, status, taskId: "saved-task" },
    );
    assert.equal(result.detail.resultUnavailable, true);
    assert.match(result.message, /暂未找到该任务的结果.*查询仍失败.*重新生成/);
    assert.match(
      result.message,
      /平台原始信息：result not exist, valid for 2 hours/,
    );
    assert.doesNotMatch(result.message, /接口或任务|已经过期|超过.*查询有效期/);
  }
  assert.equal(
    platformFailure({}, { ...options, status: 404, taskId: "saved-task" })
      .detail.resultUnavailable,
    undefined,
  );
  assert.equal(
    platformFailure(
      { error: "unknown failure" },
      { ...options, status: 404, taskId: "saved-task" },
    ).detail.resultUnavailable,
    undefined,
  );
});
