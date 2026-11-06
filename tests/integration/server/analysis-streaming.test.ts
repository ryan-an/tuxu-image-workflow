import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  fixture,
  loginHeaders,
  fakeProvider,
  counts,
  pairs,
} from "../../support/production.js";
import { Worker } from "../../../server/production/worker.js";

function events(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  return {
    async next(): Promise<any> {
      for (;;) {
        let boundary;
        while ((boundary = pending.indexOf("\n\n")) >= 0) {
          const block = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          if (block.startsWith("data: ")) return JSON.parse(block.slice(6));
        }
        const chunk = await reader.read();
        assert.equal(
          chunk.done,
          false,
          "analysis SSE must remain connected while more output is pending",
        );
        pending += decoder.decode(chunk.value, { stream: true });
      }
    },
  };
}

test(
  "rapid model updates reach analysis SSE before the model finishes without a 300ms pause",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    const connection = new AbortController();
    let release!: () => void;
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    let running: Promise<boolean> | undefined;
    try {
      const headers = await loginHeaders(f.app);
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const response = await fetch(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}/api/analysis/events`,
        {
          headers,
          signal: AbortSignal.any([
            connection.signal,
            AbortSignal.timeout(10000),
          ]),
        },
      );
      assert.match(
        response.headers.get("content-type")!,
        /^text\/event-stream/,
      );
      assert.equal(response.headers.get("x-accel-buffering"), "no");
      const stream = events(response);
      await f.workflows.enqueue(
        randomUUID(),
        pairs(f.product).slice(0, 1),
        "prompt-set",
      );
      const provider = fakeProvider(counts());
      const analyze = provider.analyze;
      const snapshots: string[] = [];
      provider.analyze = async (...args) => {
        for (const prompt of ["一", "一二", "一二三"]) {
          snapshots.push(prompt);
          await args[5]?.(`{"images":[{"role":"尺寸图","prompt":"${prompt}`);
        }
        await completion;
        return analyze(...args);
      };
      await f.due();
      running = new Worker(f.workflows, provider, () => {}).step("prompt");
      let event;
      do {
        event = await stream.next();
      } while (event.drafts?.["尺寸图"] !== "一二三");
      assert.deepEqual(snapshots, ["一", "一二", "一二三"]);
      assert.equal((await f.workflows.repo.view()).jobs[0].status, "running");
      release();
      assert.equal(await running, true);
      assert.equal((await f.workflows.repo.view()).jobs[0].status, "completed");
    } finally {
      release();
      connection.abort();
      await running?.catch(() => {});
      await f.close();
    }
  },
);

test(
  "large analysis snapshots keep the same SSE connection open for following text",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    const connection = new AbortController();
    try {
      const headers = await loginHeaders(f.app);
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const response = await fetch(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}/api/analysis/events`,
        {
          headers,
          signal: AbortSignal.any([
            connection.signal,
            AbortSignal.timeout(10000),
          ]),
        },
      );
      const stream = events(response);
      const first = "原始段落\n".repeat(20000);
      f.workflows.analysisEvents.publish({
        id: "large",
        drafts: { 尺寸图: first },
      });
      assert.equal((await stream.next()).drafts.尺寸图, first);
      const next = first + "后续正文保持同一连接";
      f.workflows.analysisEvents.publish({
        id: "large",
        drafts: { 尺寸图: next },
      });
      assert.equal((await stream.next()).drafts.尺寸图, next);
      f.workflows.analysisEvents.publish({
        id: "large",
        finished: true,
        status: "completed",
      });
      assert.equal((await stream.next()).finished, true);
    } finally {
      connection.abort();
      await f.close();
    }
  },
);
