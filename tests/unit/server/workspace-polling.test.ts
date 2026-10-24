import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceClient } from "../../../src/services/workspace-client.js";
import {
  emptyWorkspace,
  Repository,
} from "../../../server/production/repository.js";

test("unchanged workspace reads only the revision and preserves the delta response", async () => {
  const queries: string[] = [];
  const tx = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [{ revision: 35 }] };
    },
  };
  const repo = new Repository(tx as any);
  assert.deepEqual(await repo.changes(tx, 35), {
    cursor: 35,
    products: [],
    jobs: [],
    deletedProducts: [],
    deletedJobs: [],
  });
  assert.deepEqual(queries, [
    "SELECT revision FROM sync_clock WHERE id=1 AND workspace_id=$1",
  ]);
  queries.length = 0;
  assert.deepEqual(await repo.changes(tx, 36), { reset: true, cursor: 35 });
  assert.equal(queries.length, 1);
});

test("workspace polling adapts to jobs, pauses while hidden and resumes immediately", async (t) => {
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let nextTimer = 0;
  t.mock.method(
    globalThis,
    "setTimeout",
    (callback: () => void, delay: number) => {
      timers.set(++nextTimer, { callback, delay });
      return nextTimer;
    },
  );
  t.mock.method(globalThis, "clearTimeout", (id: number) => timers.delete(id));
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const previousEventSource = Object.getOwnPropertyDescriptor(
    globalThis,
    "EventSource",
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: doc,
  });
  let source: any;
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: class {
      onmessage: any;
      close() {}
      constructor() {
        source = this;
      }
    },
  });
  const state: any = { ...emptyWorkspace(), syncCursor: 35 };
  let calls = 0,
    fail = false;
  let release: (() => void) | undefined;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (release)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    if (fail) throw new Error("offline");
    return new Response(
      JSON.stringify({
        cursor: 35,
        products: [],
        jobs: [],
        deletedProducts: [],
        deletedJobs: [],
      }),
    );
  });
  const notices: string[] = [];
  const client = new WorkspaceClient(state, {
    render: () => {},
    sync: async () => {},
    notify: (message: string) => notices.push(message),
  });
  const delay = () => {
    assert.equal(timers.size, 1);
    return [...timers.values()][0].delay;
  };
  const fire = async () => {
    const [id, timer] = [...timers.entries()][0];
    timers.delete(id);
    timer.callback();
    await client.refreshing?.catch(() => {});
  };
  try {
    client.start();
    client.start();
    assert.equal(delay(), 20000);
    await fire();
    assert.equal(calls, 1);
    assert.equal(delay(), 20000);
    state.jobs.push({ id: "new", status: "queued" });
    await client.refresh(); // Explicit refresh after enqueue must shorten the idle timer.
    assert.equal(delay(), 2500);
    state.jobs[0].status = "running";
    await fire();
    assert.equal(delay(), 2500);
    state.jobs[0].status = "completed";
    await fire();
    assert.equal(delay(), 20000);
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(timers.size, 0);
    const hiddenCalls = calls;
    source.onmessage({ data: JSON.stringify({ id: "unknown" }) });
    await Promise.resolve();
    assert.equal(calls, hiddenCalls);
    doc.hidden = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    await client.refreshing;
    assert.equal(calls, hiddenCalls + 1);
    assert.equal(delay(), 20000);

    // Hiding during a request must prevent that request from restarting the timer.
    release = () => {};
    const pending = client.refresh();
    await Promise.resolve();
    await Promise.resolve();
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    doc.hidden = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(client.refresh(), pending);
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    release!();
    release = undefined;
    await pending;
    assert.equal(timers.size, 0);
    doc.hidden = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    await client.refreshing;
    fail = true;
    await fire();
    assert.equal(delay(), 20000);
    assert.equal(notices.length, 1);
    await fire();
    assert.equal(notices.length, 1);
    client.stop();
    assert.equal(timers.size, 0);
    const stoppedCalls = calls;
    doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(calls, stoppedCalls);
  } finally {
    client.stop();
    if (previousDocument)
      Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (previousEventSource)
      Object.defineProperty(globalThis, "EventSource", previousEventSource);
    else Reflect.deleteProperty(globalThis, "EventSource");
  }
});
