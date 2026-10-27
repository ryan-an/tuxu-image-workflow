import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Worker } from "../../../server/production/worker.js";
import { Credentials } from "../../../server/production/credentials.js";
import { WorkspaceClient } from "../../../src/services/workspace-client.js";
import {
  fixture,
  fakeProvider,
  counts,
  pairs,
  loginHeaders,
} from "../../support/production.js";
const secret = "12".repeat(32);

test("API authentication, field ownership, encrypted credentials and latest submitted edits", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.app.inject("/api/workspace")).statusCode, 401);
    const headers = await loginHeaders(f.app);
    const settings = await f.app.inject({
      url: "/api/workflow/settings",
      headers,
    });
    assert.equal(settings.json().hasKey, true);
    assert.ok(!settings.body.includes("fake-platform-key"));
    const row = (await f.db.query("SELECT credential FROM workspace")).rows[0];
    assert.ok(!row.credential.includes("fake-platform-key"));
    assert.equal(
      new Credentials(secret).decrypt(row.credential),
      "fake-platform-key",
    );
    assert.equal(
      (
        await f.app.inject({
          method: "PATCH",
          url: "/api/workspace",
          headers,
          payload: { edits: [{ path: ["jobs"], before: null, value: [] }] },
        })
      ).statusCode,
      400,
    );
    const edit = {
      path: ["products", f.product.id, "name"],
      before: f.product.name,
      value: "修改后的名称",
    };
    assert.equal(
      (
        await f.app.inject({
          method: "PATCH",
          url: "/api/workspace",
          headers,
          payload: { edits: [edit] },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "PATCH",
          url: "/api/workspace",
          headers,
          payload: { edits: [{ ...edit, value: "最后保存的名称" }] },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/jobs",
          headers: { ...headers, origin: "https://attacker.invalid" },
          payload: {
            commandId: randomUUID(),
            pairs: pairs(f.product),
            kind: "workflow",
          },
        })
      ).statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});
test("durable dependency pipeline, command deduplication and complete saved image history", async () => {
  const f = await fixture();
  try {
    const calls = counts(),
      worker = new Worker(f.workflows, fakeProvider(calls)),
      id = randomUUID();
    assert.equal(
      (await f.workflows.enqueue(id, pairs(f.product), "workflow")).count,
      11,
    );
    assert.equal(
      (await f.workflows.enqueue(id, pairs(f.product), "workflow")).count,
      11,
    );
    assert.equal((await f.workflows.repo.view()).jobs.length, 11);
    for (let i = 0; i < 21; i++) {
      await f.due();
      assert.equal(await worker.step(), true);
    }
    const state = await f.workflows.repo.view();
    assert.deepEqual(calls, { submit: 10, query: 10, analyze: 1 });
    assert.ok(state.jobs.every((j) => j.status === "completed"));
    assert.ok(
      state.products[0].tasks.every(
        (t) =>
          t.versions.length === 1 &&
          t.versions[0].source.startsWith("/api/assets/") &&
          t.primaryId === t.versions[0].id,
      ),
    );
    assert.ok(
      state.products[0].tasks.every(
        (t) =>
          t.selectedIds.length === 1 && t.selectedIds[0] === t.versions[0].id,
      ),
    );
  } finally {
    await f.close();
  }
});
test("new worker resumes persisted remote ID without a second paid submission", async () => {
  const f = await fixture();
  try {
    f.product.tasks[0].prompt = "ready";
    await f.workflows.edit([
      {
        path: [
          "products",
          f.product.id,
          "tasks",
          f.product.tasks[0].id,
          "prompt",
        ],
        before: "",
        value: "ready",
      },
    ]);
    const calls = counts(),
      provider = fakeProvider(calls);
    await f.workflows.enqueue(
      randomUUID(),
      pairs(f.product).slice(0, 1),
      "image",
    );
    await new Worker(f.workflows, provider).step();
    await f.reopen();
    await f.due();
    await new Worker(f.workflows, provider).step();
    assert.equal(calls.submit, 1);
    assert.equal(calls.query, 1);
    assert.equal((await f.workflows.repo.view()).jobs[0].status, "completed");
  } finally {
    await f.close();
  }
});
test("uncertain paid submission requires explicit reconciliation and never auto-resubmits", async () => {
  const f = await fixture();
  try {
    await f.workflows.edit([
      {
        path: [
          "products",
          f.product.id,
          "tasks",
          f.product.tasks[0].id,
          "prompt",
        ],
        before: "",
        value: "ready",
      },
    ]);
    const calls = counts(),
      provider = fakeProvider(calls);
    provider.submit = async () => {
      calls.submit++;
      throw new Error("connection lost");
    };
    await f.workflows.enqueue(
      randomUUID(),
      pairs(f.product).slice(0, 1),
      "image",
    );
    const worker = new Worker(f.workflows, provider);
    await worker.step();
    const job = (await f.workflows.repo.view()).jobs[0];
    assert.equal(job.status, "interrupted");
    await assert.rejects(
      f.workflows.control(job.id, "retry", { commandId: randomUUID() }),
      /核对/,
    );
    assert.equal(await worker.step(), false);
    await f.workflows.control(job.id, "reconcile", {
      commandId: randomUUID(),
      remoteId: "known-platform-id",
    });
    await f.due();
    await worker.step();
    assert.equal(calls.submit, 1);
    assert.equal(calls.query, 1);
  } finally {
    await f.close();
  }
});
test("expired worker lease preserves uncertain boundary; claims remain exclusive without a concurrency cap", async () => {
  const f = await fixture();
  try {
    await f.workflows.edit([{ path: ["concurrency"], before: 2, value: 1 }]);
    for (const task of f.product.tasks.slice(0, 2))
      await f.workflows.edit([
        {
          path: ["products", f.product.id, "tasks", task.id, "prompt"],
          before: "",
          value: "ready",
        },
      ]);
    await f.workflows.enqueue(
      randomUUID(),
      pairs(f.product).slice(0, 2),
      "image",
    );
    await f.due();
    const [a, b] = await Promise.all([
      f.workflows.repo.claim("a"),
      f.workflows.repo.claim("b"),
    ]);
    assert.equal([a, b].filter(Boolean).length, 2);
    assert.notEqual(a!.id, b!.id);
    const job = a || b;
    await f.workflows.repo.markStage(job!, "submitting");
    await f.workflows.repo.claim("replacement", Date.now() + 300000);
    assert.equal(
      (await f.workflows.repo.view()).jobs.find((j) => j.id === job!.id)!
        .status,
      "interrupted",
    );
  } finally {
    await f.close();
  }
});
test("editing during analysis preserves the draft and records generated prompt in history", async () => {
  const f = await fixture();
  try {
    const calls = counts(),
      provider = fakeProvider(calls);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (entered = r)),
      analyze = provider.analyze;
    provider.analyze = async (...args) => {
      entered();
      await gate;
      return analyze(...args);
    };
    await f.workflows.enqueue(randomUUID(), pairs(f.product), "prompt");
    const running = new Worker(f.workflows, provider).step();
    await started;
    await f.workflows.edit([
      {
        path: [
          "products",
          f.product.id,
          "tasks",
          f.product.tasks[0].id,
          "prompt",
        ],
        before: "",
        value: "我的新草稿",
      },
    ]);
    release();
    await running;
    const task = (await f.workflows.repo.view()).products[0].tasks[0];
    assert.equal(task.prompt, "我的新草稿");
    assert.equal(task.promptHistory.at(-1).prompt, "prompt:尺寸图");
  } finally {
    await f.close();
  }
});
test("cancel during submission still records remote ID and does not add an image", async () => {
  const f = await fixture();
  try {
    await f.workflows.edit([
      {
        path: [
          "products",
          f.product.id,
          "tasks",
          f.product.tasks[0].id,
          "prompt",
        ],
        before: "",
        value: "ready",
      },
    ]);
    await f.workflows.enqueue(
      randomUUID(),
      pairs(f.product).slice(0, 1),
      "image",
    );
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (entered = r));
    const calls = counts(),
      provider = fakeProvider(calls);
    provider.submit = async () => {
      entered();
      await gate;
      return { id: "cancelled-remote" };
    };
    await f.due();
    const running = new Worker(f.workflows, provider).step();
    await started;
    const job = (await f.workflows.repo.view()).jobs[0];
    await f.workflows.control(job.id, "cancel", { commandId: randomUUID() });
    release();
    await running;
    const state = await f.workflows.repo.view();
    assert.equal(state.jobs[0].status, "cancelled");
    assert.equal(state.jobs[0].remoteId, "cancelled-remote");
    assert.equal(state.products[0].tasks[0].versions.length, 0);
  } finally {
    await f.close();
  }
});
test("client polling retains unsaved changes and their original conflict precondition", async () => {
  const original = globalThis.fetch;
  const state = {
    schema: 2,
    common: "before",
    concurrency: 2,
    settings: { mode: "live" },
    products: [],
    jobs: [],
    sheetSnapshot: null,
  };
  const client = new WorkspaceClient(state, {
    render() {},
    sync: async () => {},
    notify() {},
  });
  state.common = "my draft";
  globalThis.fetch = async (_url, options) => {
    if (options?.method === "PATCH") {
      assert.equal(
        JSON.parse(options.body as string).edits[0].before,
        "before",
      );
      return Response.json({ error: "conflict" }, { status: 409 });
    }
    return Response.json({ ...state, common: "other editor" });
  };
  try {
    await client.refresh();
    assert.equal(state.common, "my draft");
    await assert.rejects(client.save(), /conflict/);
  } finally {
    globalThis.fetch = original;
  }
});
