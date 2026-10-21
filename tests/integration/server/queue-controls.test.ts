import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Worker } from "../../../server/production/worker.js";
import { ProviderError } from "../../../server/production/provider.js";
import {
  counts,
  fakeProvider,
  fixture,
  loginHeaders,
  pairs,
} from "../../support/production.js";

test("retrying analysis does not revive a dependent image when its position already has new work", async () => {
  const f = await fixture();
  try {
    await f.workflows.enqueue(randomUUID(), pairs(f.product), "workflow");
    const provider = fakeProvider(counts());
    provider.analyze = async () => {
      throw new ProviderError("分析失败", false, true);
    };
    const worker = new Worker(f.workflows, provider, () => {});
    await worker.step();
    await worker.step();
    const before = await f.workflows.repo.view();
    const parent = before.jobs.find((j) => j.kind === "prompt-set")!;
    const child = before.jobs.find((j) => j.dependsOn === parent.id)!;
    const replacementId = randomUUID();
    await f.db.transaction((tx) =>
      f.workflows.repo.insertJob(tx, {
        ...child,
        id: replacementId,
        dependsOn: undefined,
        status: "queued",
        prompt: "新任务提示词",
      }),
    );
    await f.workflows.control(parent.id, "retry", { commandId: randomUUID() });
    const after = await f.workflows.repo.view();
    assert.equal(after.jobs.find((j) => j.id === child.id)?.status, "failed");
    assert.equal(
      after.jobs.find((j) => j.id === replacementId)?.status,
      "queued",
    );
    assert.equal(
      after.jobs.filter(
        (j) => j.dependsOn === parent.id && j.status === "queued",
      ).length,
      9,
    );
  } finally {
    await f.close();
  }
});

test("batch pending cancellation is atomic and keeps accepted image results queryable", async () => {
  const f = await fixture();
  try {
    await f.workflows.enqueue(randomUUID(), pairs(f.product), "workflow");
    const calls = counts(),
      worker = new Worker(f.workflows, fakeProvider(calls));
    await worker.step(); // Analysis.
    await worker.step(); // One paid submission, now queued for polling.
    const headers = await loginHeaders(f.app);
    const response = await f.app.inject({
      method: "POST",
      url: "/api/jobs/queue/control",
      headers,
      payload: { commandId: randomUUID(), action: "cancel-pending" },
    });
    assert.equal(response.statusCode, 200);
    const state = await f.workflows.repo.view();
    assert.equal(state.jobs.filter((j) => j.status === "cancelled").length, 9);
    assert.equal(
      state.jobs.filter((j) => j.status === "queued" && j.remoteId).length,
      1,
    );
    await f.due();
    await worker.step();
    assert.deepEqual(calls, { analyze: 1, submit: 1, query: 1 });
    assert.equal(
      (await f.workflows.repo.view()).products[0].tasks.flatMap(
        (t) => t.versions,
      ).length,
      1,
    );
  } finally {
    await f.close();
  }
});

test("cancelling a product during analysis cancels every dependent image before dispatch", async () => {
  const f = await fixture();
  try {
    await f.workflows.enqueue(randomUUID(), pairs(f.product), "workflow");
    const calls = counts(),
      provider = fakeProvider(calls);
    let started!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve));
    provider.analyze = async (_p, _c, _config, _key, signal) => {
      started();
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        });
      });
    };
    const running = new Worker(f.workflows, provider, () => {}).step();
    await ready;
    const commandId = randomUUID();
    await f.workflows.control("queue", "cancel-product", {
      commandId,
      productId: f.product.id,
    });
    await running;
    assert.ok(
      (await f.workflows.repo.view()).jobs.every(
        (j) => j.status === "cancelled",
      ),
    );
    assert.equal(await new Worker(f.workflows, provider).step(), false);
    assert.equal(calls.submit, 0);
    // Command replay is idempotent.
    await f.workflows.control("queue", "cancel-product", {
      commandId,
      productId: f.product.id,
    });
  } finally {
    await f.close();
  }
});
