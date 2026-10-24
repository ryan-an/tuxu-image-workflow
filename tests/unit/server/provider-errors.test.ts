import test from "node:test";
import assert from "node:assert/strict";
import {
  GrsaiProvider,
  ProviderError,
} from "../../../server/production/provider.js";

const key = "hidden-test-key";
const config = {
  baseUrl: "https://grsai.dakka.com.cn",
  promptModel: "doubao-test",
  imageModel: "gpt-image-2",
};
const signal = () => new AbortController().signal;
function stream(value: unknown) {
  return new Response(`data: ${JSON.stringify(value)}\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

test("Doubao JSON and SSE expose real failures, nested reasons, codes and request IDs", async () => {
  const original = globalThis.fetch;
  const provider = new GrsaiProvider({} as any);
  try {
    for (const response of [
      () =>
        Response.json({
          error: { code: "InsufficientBalance", message: "账户余额不足" },
        }),
      () =>
        stream({
          type: "error",
          code: "InsufficientBalance",
          message: "账户余额不足",
        }),
      () =>
        stream({
          type: "response.failed",
          response: {
            status: "failed",
            error: { code: "InsufficientBalance", message: "账户余额不足" },
            request_id: "req-doubao",
          },
        }),
    ]) {
      globalThis.fetch = async () => response();
      await assert.rejects(
        provider.chat([], config, key, signal()),
        (error: any) => {
          assert.ok(error instanceof ProviderError && error.definitive);
          assert.match(error.message, /豆包提示词模型调用失败：账户余额不足/);
          assert.match(error.message, /InsufficientBalance/);
          assert.equal(error.upstream?.code, "InsufficientBalance");
          return true;
        },
      );
    }
    for (const json of [false, true]) {
      const failure = {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      };
      globalThis.fetch = async () =>
        json
          ? Response.json(failure)
          : stream({ type: "response.incomplete", response: failure });
      await assert.rejects(
        provider.chat([], config, key, signal()),
        /max_output_tokens/,
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("image submission preserves HTTP and business errors instead of reporting missing task IDs", async () => {
  const original = globalThis.fetch;
  const provider = new GrsaiProvider({} as any);
  try {
    for (const [status, body] of [
      [402, { error: { code: "balance_low", message: `余额不足 ${key}` } }],
      [200, { code: 400, msg: "模型维护中" }],
      [200, { status: "failed", error: "生成失败，请重试", id: "image-task" }],
    ] as const) {
      globalThis.fetch = async () => Response.json(body, { status });
      await assert.rejects(
        provider.submit("prompt", [], config, key, signal()),
        (error: any) => {
          assert.ok(error instanceof ProviderError && error.definitive);
          assert.match(error.message, /生图模型调用失败/);
          assert.match(error.message, /余额不足|模型维护中|生成失败，请重试/);
          assert.doesNotMatch(
            error.message,
            /hidden-test-key|没有返回任务 ID|分析平台/,
          );
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("image polling preserves violation and failure reasons with the original task ID", async () => {
  const original = globalThis.fetch;
  const provider = new GrsaiProvider({} as any);
  try {
    for (const status of ["failed", "violation"]) {
      globalThis.fetch = async () =>
        Response.json({
          status,
          failure_reason: "input_moderation",
          error: "参考图未通过审核",
        });
      await assert.rejects(
        provider.query("original-task", config, key, signal()),
        (error: any) => {
          assert.ok(error.definitive);
          assert.match(error.message, /参考图未通过审核；input_moderation/);
          assert.match(error.message, /任务 ID：original-task/);
          return true;
        },
      );
    }
    globalThis.fetch = async () =>
      Response.json({
        status: "succeeded",
        error: "",
        results: [{ url: "https://example.com/result.png" }],
      });
    assert.equal(
      (await provider.query("original-task", config, key, signal())).source,
      "https://example.com/result.png",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("unexplained HTTP failures do not guess balance or model problems; text errors are bounded and redacted", async () => {
  const original = globalThis.fetch;
  const provider = new GrsaiProvider({} as any);
  try {
    for (const response of [
      () =>
        new Response("<html>private proxy error</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
      () => Response.json({}, { status: 429 }),
      () =>
        Response.json(
          { error: { message: "x".repeat(65537) } },
          { status: 500 },
        ),
    ]) {
      globalThis.fetch = async () => response();
      await assert.rejects(
        provider.chat([], config, key, signal()),
        (error: any) => {
          assert.match(error.message, /平台未提供具体失败原因/);
          assert.doesNotMatch(
            error.message,
            /余额|配额|private proxy|模型不可用/,
          );
          return true;
        },
      );
    }
    globalThis.fetch = async () =>
      new Response(`Model unavailable ${key} Bearer secret-token`, {
        status: 503,
        headers: { "x-request-id": "req-503" },
      });
    await assert.rejects(
      provider.query("image-task", config, key, signal()),
      (error: any) => {
        assert.match(error.message, /Model unavailable/);
        assert.match(error.message, /req-503/);
        assert.doesNotMatch(error.message, /hidden-test-key|secret-token/);
        return true;
      },
    );
    globalThis.fetch = async () =>
      Response.json({ error: { message: "y".repeat(5000) } }, { status: 500 });
    await assert.rejects(
      provider.chat([], config, key, signal()),
      (error: any) => error.message.length < 2500,
    );
  } finally {
    globalThis.fetch = original;
  }
});
