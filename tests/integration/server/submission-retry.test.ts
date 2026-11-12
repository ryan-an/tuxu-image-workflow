import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  fixture,
  fakeProvider,
  counts,
  pairs,
  loginHeaders,
} from "../../support/production.js";
import { Worker } from "../../../server/production/worker.js";
import { ProviderError } from "../../../server/production/provider.js";
import { migrate } from "../../../server/production/database.js";
import type { Job } from "../../../server/production/types.js";

test("invalid returned IDs fail without blocking a fresh image submission", async () => {
  const f = await fixture();
  try {
    const invalid = [undefined, "", "  ", 123];
    await f.workflows.edit(
      f.product.tasks.slice(0, invalid.length).map((task) => ({
        path: ["products", f.product.id, "tasks", task.id, "prompt"],
        before: "",
        value: "ready",
      })),
    );
    const calls = counts(),
      provider = fakeProvider(calls);
    const worker = new Worker(f.workflows, provider, () => {});
    for (const [index, id] of invalid.entries()) {
      provider.submit = async () => {
        calls.submit++;
        return { id: id as any };
      };
      const target = pairs(f.product).slice(index, index + 1);
      await f.workflows.enqueue(randomUUID(), target, "image");
      assert.equal(await worker.step(), true);
      const failed = (await f.workflows.repo.view()).jobs.find(
        (job) => job.taskId === target[0].taskId,
      )!;
      assert.equal(failed.status, "failed");
      assert.equal(failed.stage, "pending");
      assert.equal(failed.remoteId, undefined);
      assert.match(failed.error, /未返回任务 ID.*提交失败/);
      assert.equal(await worker.step(), false);
      assert.equal(
        (await f.workflows.enqueue(randomUUID(), target, "image")).count,
        1,
      );
      const retry = (await f.workflows.repo.view()).jobs.find(
        (job) => job.taskId === target[0].taskId && job.status === "queued",
      )!;
      await f.workflows.control(retry.id, "cancel", {
        commandId: randomUUID(),
      });
    }
    assert.equal(calls.submit, invalid.length);
    assert.equal(calls.query, 0);
  } finally {
    await f.close();
  }
});

test("timed-out and rate-limited image submissions without an ID fail for a direct user retry", async () => {
  const f = await fixture();
  try {
    await f.workflows.edit(
      f.product.tasks.slice(0, 2).map((task) => ({
        path: ["products", f.product.id, "tasks", task.id, "prompt"],
        before: "",
        value: "ready",
      })),
    );
    const calls = counts(),
      provider = fakeProvider(calls);
    const errors = [
      new DOMException("提交超时", "TimeoutError"),
      new ProviderError("平台繁忙", true, true, { status: 429 }, 5000),
    ];
    for (const [index, error] of errors.entries()) {
      provider.submit = async () => {
        calls.submit++;
        throw error;
      };
      await f.workflows.enqueue(
        randomUUID(),
        pairs(f.product).slice(index, index + 1),
        "image",
      );
      const worker = new Worker(f.workflows, provider, () => {});
      assert.equal(await worker.step(), true);
      const job = (await f.workflows.repo.view()).jobs.find(
        (job) => job.taskId === f.product.tasks[index].id,
      )!;
      assert.equal(job.status, "failed");
      assert.equal(job.stage, "pending");
      assert.equal(job.rateLimitUntil, undefined);
      assert.equal(await worker.step(), false);
      await f.workflows.control(job.id, "retry", { commandId: randomUUID() });
      await f.workflows.control(job.id, "cancel", { commandId: randomUUID() });
    }
    assert.deepEqual(calls, { analyze: 0, submit: 2, query: 0 });
  } finally {
    await f.close();
  }
});

test("a received ID survives a transient first persistence failure and is queried after restart", async (t) => {
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
        value: "frozen input",
      },
    ]);
    await f.workflows.enqueue(
      randomUUID(),
      pairs(f.product).slice(0, 1),
      "image",
    );
    const calls = counts(),
      provider = fakeProvider(calls);
    const update = f.workflows.repo.updateClaim.bind(f.workflows.repo);
    let first = true;
    t.mock.method(
      f.workflows.repo,
      "updateClaim",
      async (...args: Parameters<typeof update>) => {
        if (first) {
          first = false;
          throw new Error("temporary write failure");
        }
        return update(...args);
      },
    );
    assert.equal(
      await new Worker(f.workflows, provider, () => {}).step(),
      true,
    );
    const row = (
      await f.db.query("SELECT remote_id,status,stage,payload FROM jobs")
    ).rows[0];
    assert.equal(row.remote_id, "remote-1");
    assert.equal(row.payload.remoteId, "remote-1");
    assert.equal(row.payload.prompt, "frozen input");
    assert.equal(row.status, "queued");
    assert.equal(row.stage, "polling");
    await f.reopen();
    await f.due();
    await new Worker(f.workflows, provider, () => {}).step();
    assert.deepEqual(calls, { analyze: 0, submit: 1, query: 1 });
    assert.equal((await f.workflows.repo.view()).jobs[0].status, "completed");
  } finally {
    await f.close();
  }
});

test("020 converts old platform-check records without resubmitting and preserves saved IDs and other states", async () => {
  const f = await fixture();
  try {
    const settings = (await f.workflows.repo.view()).settings;
    const variants: Partial<Job>[] = [
      { status: "interrupted", stage: "submitting" },
      {
        status: "interrupted",
        stage: "analyzing",
        kind: "prompt-set",
        taskIds: [f.product.tasks[1].id],
      },
      {
        status: "interrupted",
        stage: "polling",
        remoteId: "saved-platform-id",
      },
      { status: "failed", stage: "submitting" },
      { status: "cancelled", stage: "submitting" },
      { status: "completed", stage: "completed", remoteId: "completed-id" },
      { status: "queued", stage: "pending" },
      { status: "running", stage: "submitting" },
    ];
    const jobs: Job[] = variants.map(
      (variant, index) =>
        ({
          id: randomUUID(),
          productId: f.product.id,
          productName: f.product.name,
          taskId:
            variant.kind === "prompt-set"
              ? undefined
              : f.product.tasks[index].id,
          kind: "image",
          role: f.product.tasks[index].role,
          mode: "live",
          config: settings,
          createdAt: index + 1,
          error: "旧任务，请核对平台后处理",
          ...variant,
        }) as Job,
    );
    await f.db.transaction(async (tx) => {
      for (const job of jobs) await f.workflows.repo.insertJob(tx, job);
      await tx.query("DELETE FROM schema_migrations WHERE version='020.sql'");
    });
    const unchanged = (
      await f.db.query(
        "SELECT * FROM jobs WHERE status IN ('completed','queued','running') ORDER BY id",
      )
    ).rows;
    await migrate(f.db);
    const after = (await f.workflows.repo.view()).jobs;
    const find = (index: number) =>
      after.find((job) => job.id === jobs[index].id)!;
    for (const index of [0, 1, 3]) {
      assert.equal(find(index).status, "failed");
      assert.equal(find(index).stage, "pending");
      assert.doesNotMatch(find(index).error, /核对/);
    }
    assert.equal(find(2).status, "queued");
    assert.equal(find(2).stage, "polling");
    assert.equal(find(2).remoteId, "saved-platform-id");
    assert.equal(find(4).status, "cancelled");
    assert.equal(find(4).stage, "pending");
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT * FROM jobs WHERE id IN ($1,$2,$3) ORDER BY id",
          jobs.slice(5).map((job) => job.id),
        )
      ).rows,
      unchanged,
    );
    const migrated = (await f.db.query("SELECT * FROM jobs ORDER BY id")).rows;
    await migrate(f.db);
    assert.deepEqual(
      (await f.db.query("SELECT * FROM jobs ORDER BY id")).rows,
      migrated,
    );
    const headers = await loginHeaders(f.app);
    const retry = await f.app.inject({
      method: "POST",
      url: `/api/jobs/${jobs[0].id}/control`,
      headers,
      payload: { commandId: randomUUID(), action: "retry" },
    });
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal((await f.workflows.repo.job(jobs[0].id))!.stage, "pending");
  } finally {
    await f.close();
  }
});
