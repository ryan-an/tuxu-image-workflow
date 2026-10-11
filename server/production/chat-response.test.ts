import test from "node:test";
import assert from "node:assert/strict";
import { readChatResponse } from "./chat-response.js";
import { GrsaiProvider, ProviderError } from "./provider.js";
import { stageTimeout, leaseDuration } from "./execution-limits.js";
function stream(text: string, end = true) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3)
          controller.enqueue(bytes.slice(i, i + 3));
        if (end) controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
test("Chat handles split UTF-8 SSE, heartbeats, usage and DONE without waiting for connection close", async () => {
  const events =
    ': ping\r\n\r\ndata: {"choices":[{"delta":{"content":"中文"}}]}\r\n\r\ndata: {"choices":[],"usage":{}}\r\n\r\ndata: {"choices":[{"delta":{"content":"结果"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n';
  const result = await readChatResponse(stream(events, false));
  assert.equal(result.choices[0].message.content, "中文结果");
});
test("HTTP failure and SSE error are handled without waiting for an open response body", async () => {
  await assert.rejects(
    readChatResponse(
      stream('data: {"error":{"code":"invalid_model"}}\n\n', false),
    ),
    /明确返回失败/,
  );
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(new ReadableStream({ start() {} }), { status: 429 });
  try {
    const provider = new GrsaiProvider({} as any);
    await assert.rejects(
      provider.query(
        "test-id",
        { baseUrl: "https://grsai.dakka.com.cn" },
        "hidden-test-key",
        new AbortController().signal,
      ),
      (error: any) =>
        error instanceof ProviderError &&
        error.definitive &&
        /429/.test(error.message),
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("Chat rejects truncated streams and preserves JSON responses", async () => {
  await assert.rejects(
    readChatResponse(
      stream('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
    ),
    /中途断开/,
  );
  await assert.rejects(
    readChatResponse(
      stream(
        'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
      ),
    ),
    /长度限制/,
  );
  const json = { choices: [{ message: { content: "OK" } }] };
  assert.deepEqual(await readChatResponse(Response.json(json)), json);
  assert.ok(stageTimeout("prompt-set") > 180000);
  assert.ok(leaseDuration("prompt-set") > stageTimeout("prompt-set"));
});
