import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { setImmediate } from "node:timers/promises";
import { analysisStream } from "../../../server/production/analysis-stream.js";

class ResponseSocket extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  blocked = false;
  writes: string[] = [];
  write(text: string) {
    this.writes.push(text);
    return !this.blocked;
  }
  end() {
    this.writableEnded = true;
    this.emit("close");
  }
  get events() {
    return this.writes.map((text) => JSON.parse(text.slice(6)));
  }
}

test("analysis stream waits for drain and keeps only the latest cumulative snapshot per job", async () => {
  const raw = new ResponseSocket();
  raw.blocked = true;
  const send = analysisStream(
    raw as unknown as ServerResponse,
    async () => true,
  );
  send({ id: "a", drafts: { 尺寸图: "第一段" } });
  await setImmediate();
  assert.equal(raw.writableEnded, false);
  assert.equal(raw.events.length, 1);
  send({ id: "a", drafts: { 尺寸图: "第一段，第二段" } });
  send({ id: "a", drafts: { 尺寸图: "第一段，第二段，第三段" } });
  send({ id: "a", analysisPhase: "streaming" });
  send({ id: "b", drafts: { 卖点图: "另一个任务的正文" } });
  await setImmediate();
  assert.equal(raw.events.length, 1);
  raw.blocked = false;
  raw.emit("drain");
  await setImmediate();
  assert.deepEqual(raw.events.slice(1), [
    {
      id: "a",
      drafts: { 尺寸图: "第一段，第二段，第三段" },
      analysisPhase: "streaming",
    },
    { id: "b", drafts: { 卖点图: "另一个任务的正文" } },
  ]);
  assert.equal(raw.writableEnded, false);
  raw.end();
  assert.equal(raw.listenerCount("drain"), 0);
});

test("pending completion supersedes old snapshots without reverting to earlier content", async () => {
  const raw = new ResponseSocket();
  let allow!: (value: boolean) => void;
  const permission = new Promise<boolean>((resolve) => {
    allow = resolve;
  });
  const send = analysisStream(
    raw as unknown as ServerResponse,
    () => permission,
  );
  send({ id: "a", drafts: { 尺寸图: "旧正文" } });
  send({ id: "a", drafts: { 尺寸图: "新正文" } });
  send({ id: "a", finished: true, status: "completed" });
  allow(true);
  await setImmediate();
  assert.deepEqual(raw.events, [
    { id: "a", finished: true, status: "completed" },
  ]);
  raw.end();
});

test("revoked or failed authorization closes analysis streams without writing queued content", async () => {
  for (const authorize of [
    async () => false,
    async () => {
      throw new Error("session expired");
    },
  ]) {
    const raw = new ResponseSocket();
    const send = analysisStream(raw as unknown as ServerResponse, authorize);
    send({ id: "a", drafts: { 尺寸图: "正文" } });
    await setImmediate();
    send({ id: "a", drafts: { 尺寸图: "后续正文" } });
    assert.deepEqual(raw.events, []);
    assert.equal(raw.writableEnded, true);
    assert.equal(raw.listenerCount("drain"), 0);
  }
});
