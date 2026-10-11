import test from "node:test";
import assert from "node:assert/strict";
import { fixture, pairs, fakeProvider, counts } from "./test-support.js";
import { Worker } from "./worker.js";
test("terminating running analysis aborts its request, releases the claim and cancels dependent images", async () => {
  const f = await fixture();
  try {
    await f.workflows.enqueue(
      "cancel-running-suite",
      pairs(f.product),
      "workflow",
    );
    const provider = fakeProvider(counts());
    let began!: () => void, captured!: AbortSignal;
    const started = new Promise<void>((resolve) => (began = resolve));
    provider.analyze = async (_p, _common, _config, _key, signal) => {
      captured = signal;
      began();
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    };
    const errors: unknown[] = [];
    const worker = new Worker(f.workflows, provider, (error) =>
      errors.push(error),
    );
    const running = worker.step();
    await started;
    const job = (await f.workflows.repo.view()).jobs.find(
      (job) => job.kind === "prompt-set",
    )!;
    await f.workflows.control(job.id, "cancel", {
      commandId: "terminate-running-suite",
    });
    assert.equal(captured.aborted, true);
    await running;
    const state = await f.workflows.repo.view();
    assert.ok(state.jobs.every((job) => job.status === "cancelled"));
    assert.equal(state.products[0].promptSets.length, 0);
    assert.equal(
      (
        await f.db.query("SELECT owner,lease_until FROM jobs WHERE id=$1", [
          job.id,
        ])
      ).rows[0].owner,
      null,
    );
    assert.equal(await worker.step(), false);
    assert.equal(f.workflows.analysisEvents.listenerCount("cancel"), 0);
    assert.deepEqual(errors, []);
  } finally {
    await f.close();
  }
});
