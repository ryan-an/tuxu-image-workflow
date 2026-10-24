import test from "node:test";
import assert from "node:assert/strict";
import {
  readChatResponse,
  readResponsesResponse,
  ChatAPIError,
} from "../../../server/production/chat-response.js";
import {
  GrsaiProvider,
  ProviderError,
} from "../../../server/production/provider.js";
import {
  stageTimeout,
  leaseDuration,
} from "../../../server/production/execution-limits.js";
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

test("Doubao Responses assembles split UTF-8, ignores reasoning and completes without waiting for EOF", async () => {
  const progress: string[] = [];
  const result = await readResponsesResponse(
    stream(
      [
        ": ping\r\n\r\n",
        'data: {"type":"response.reasoning_summary_text.delta","delta":"不应展示"}\r\n\r\n',
        'data: {"type":"response.output_text.delta","delta":"中文"}\r\n\r\n',
        'data: {"type":"response.output_text.delta","delta":"结果"}\r\n\r\n',
        'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"中文结果"}]}]}}\r\n\r\n',
      ].join(""),
      false,
    ),
    async (text) => {
      progress.push(text);
    },
  );
  assert.equal(result.choices[0].message.content, "中文结果");
  assert.ok(progress.includes("中文"));
  assert.equal(progress.at(-1), "中文结果");
});

test("Doubao Responses rejects incomplete, failed and truncated output and accepts JSON", async () => {
  for (const type of ["error", "response.failed", "response.incomplete"])
    await assert.rejects(
      readResponsesResponse(
        stream(`data: ${JSON.stringify({ type })}\n\n`, false),
      ),
      ChatAPIError,
    );
  await assert.rejects(
    readResponsesResponse(
      stream(
        'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
      ),
    ),
    /中途断开/,
  );
  await assert.rejects(
    readResponsesResponse(Response.json({ status: "incomplete" })),
    /不完整/,
  );
  const response = await readResponsesResponse(
    Response.json({
      status: "completed",
      output: [
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "hidden" }],
        },
        { type: "message", content: [{ type: "output_text", text: "OK" }] },
      ],
    }),
  );
  assert.equal(response.choices[0].message.content, "OK");
});

test("Doubao HTTP failures preserve actual messages and actionable codes while redacting keys", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      {
        error: {
          code: "ModelNotOpen",
          message: "private upstream detail hidden-test-key",
        },
      },
      { status: 404, headers: { "x-request-id": "request-test-404" } },
    );
  try {
    await assert.rejects(
      new GrsaiProvider({} as any).chat(
        [],
        { promptModel: "doubao-test" },
        "hidden-test-key",
        new AbortController().signal,
      ),
      (error: any) => {
        assert.ok(error instanceof ProviderError);
        assert.match(error.message, /尚未.*开通/);
        assert.match(error.message, /private upstream detail \[已隐藏\]/);
        assert.doesNotMatch(error.message, /hidden-test-key/);
        assert.deepEqual(error.upstream, {
          status: 404,
          code: "ModelNotOpen",
          requestId: "request-test-404",
          action: "open-model",
        });
        return true;
      },
    );
    globalThis.fetch = async () =>
      Response.json(
        { error: { code: "InvalidEndpointOrModel.ModelIDAccessDisabled" } },
        { status: 404 },
      );
    await assert.rejects(
      new GrsaiProvider({} as any).chat(
        [],
        {},
        "hidden-test-key",
        new AbortController().signal,
      ),
      /ep-…/,
    );
    globalThis.fetch = async () => new Response("not json", { status: 404 });
    await assert.rejects(
      new GrsaiProvider({} as any).chat(
        [],
        {},
        "hidden-test-key",
        new AbortController().signal,
      ),
      /not json.*HTTP 404/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
