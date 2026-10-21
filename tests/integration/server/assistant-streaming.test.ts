import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, loginHeaders } from "../../support/production.js";
import {
  readAssistantStream,
  AssistantRequestError,
} from "../../../src/services/assistant.js";

const encode = (value: object) =>
  new TextEncoder().encode(`data: ${JSON.stringify(value)}\r\n\r\n`);
const completed = (text: string) => ({
  type: "response.completed",
  response: {
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
  },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test(
  "assistant flushes headers before upstream headers and forwards text before upstream completion",
  { timeout: 15000 },
  async () => {
    const f = await fixture(),
      original = globalThis.fetch;
    const upstreamHeaders = deferred<Response>();
    const firstText = deferred<void>();
    let source!: ReadableStreamDefaultController<Uint8Array>,
      calls = 0;
    let ended = false;
    globalThis.fetch = async () => {
      calls++;
      return upstreamHeaders.promise;
    };
    try {
      const headers = await loginHeaders(f.app);
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const id = (
        await f.app.inject({
          method: "POST",
          url: "/api/assistant/conversations",
          headers,
          payload: {},
        })
      ).json().id;
      const body = {
        conversationId: id,
        turnId: randomUUID(),
        message: "实时咨询",
        stream: true,
      };
      const post = () =>
        original(`${root}/api/assistant/chat`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        });
      // No upstream response exists yet: receiving headers here proves immediate flushing.
      const response = await post();
      assert.equal(
        response.headers.get("content-type"),
        "text/event-stream; charset=utf-8",
      );
      assert.equal(response.headers.get("x-accel-buffering"), "no");
      assert.equal(response.headers.get("content-length"), null);
      const progress: string[] = [];
      const result = readAssistantStream(response, (event) => {
        progress.push(event.text);
        if (progress.length === 2) firstText.resolve();
      }).then((value) => {
        ended = true;
        return value;
      });
      upstreamHeaders.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              source = controller;
            },
          }),
          {
            headers: { "content-type": "text/event-stream" },
          },
        ),
      );
      // Two events in a single network chunk must still be forwarded separately.
      const first = encode({
        type: "response.output_text.delta",
        delta: "**产品**",
      });
      const second = encode({
        type: "response.output_text.delta",
        delta: "建议",
      });
      source.enqueue(new Uint8Array([...first, ...second]));
      await firstText.promise;
      assert.equal(
        ended,
        false,
        "text must arrive while the upstream is still open",
      );
      assert.deepEqual(progress, ["**产品**", "建议"]);
      source.enqueue(encode(completed("**产品**建议")));
      // Leave the upstream socket open after the completed event.
      const answer = await result;
      assert.equal(answer.text, "**产品**建议");
      assert.equal(answer.conversation.turns[0].assistantText, answer.text);
      assert.equal(answer.conversation.turns[0].status, "completed");
      const cached = await readAssistantStream(await post(), () =>
        assert.fail("cached answer must not replay invented deltas"),
      );
      assert.equal(cached.text, answer.text);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = original;
      await f.close();
    }
  },
);

test(
  "truncated upstream sends a terminal SSE error and persists its partial answer",
  { timeout: 15000 },
  async () => {
    const f = await fixture(),
      original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encode({
                type: "response.output_text.delta",
                delta: "已收到的部分",
              }),
            );
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    try {
      const headers = await loginHeaders(f.app);
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const response = await original(`${root}/api/assistant/chat`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ message: "断线测试", stream: true }),
        signal: AbortSignal.timeout(10000),
      });
      let text = "";
      await assert.rejects(
        readAssistantStream(response, (event) => {
          text += event.text;
        }),
        (error: any) => {
          assert.ok(error instanceof AssistantRequestError);
          assert.ok(error.conversation);
          assert.equal(error.status, 502);
          assert.equal(
            error.conversation.turns[0].assistantText,
            "已收到的部分",
          );
          assert.equal(error.conversation.turns[0].status, "failed");
          return true;
        },
      );
      assert.equal(text, "已收到的部分");
      await f.reopen();
      const saved = await f.db.query(
        "SELECT assistant_text,status FROM assistant_turns",
      );
      assert.deepEqual(saved.rows, [
        { assistant_text: "已收到的部分", status: "failed" },
      ]);
    } finally {
      globalThis.fetch = original;
      await f.close();
    }
  },
);

test("frontend stream decoder handles split Chinese UTF-8, heartbeats and unfinished responses", async () => {
  const bytes = new TextEncoder().encode(
    ': heartbeat\r\n\r\nevent: delta\r\ndata: {"conversationId":"c","turnId":"t","delta":"中文"}\r\n\r\nevent: snapshot\r\ndata: {"conversationId":"c","turnId":"t","text":"校正"}\r\n\r\nevent: done\r\ndata: {"text":"校正"}\r\n\r\n',
  );
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3)
          controller.enqueue(bytes.slice(i, i + 3));
        // A done event must finish decoding without waiting for EOF.
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  const events: object[] = [];
  assert.equal(
    (await readAssistantStream(response, (event) => events.push(event))).text,
    "校正",
  );
  assert.deepEqual(events, [
    { type: "delta", conversationId: "c", turnId: "t", text: "中文" },
    { type: "snapshot", conversationId: "c", turnId: "t", text: "校正" },
  ]);
  await assert.rejects(
    readAssistantStream(
      new Response("event: delta\ndata: {}\n\n", {
        headers: { "content-type": "text/event-stream" },
      }),
      () => {},
    ),
    /中断/,
  );
});
