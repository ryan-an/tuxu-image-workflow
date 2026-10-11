import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, fakeProvider, counts, pairs, png } from "./test-support.js";
import { Worker } from "./worker.js";
import { ProviderError } from "./provider.js";
import { newProduct } from "../../shared/model.js";
import type { Product } from "./types.js";
test("download failure retries the same platform task and manual recovery preserves its ID", async () => {
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
    provider.query = async () => {
      calls.query++;
      return {
        status: "succeeded",
        source: calls.query <= 5 ? "data:image/png;base64,aW52YWxpZA==" : png,
      };
    };
    await f.workflows.enqueue(
      randomUUID(),
      pairs(f.product).slice(0, 1),
      "image",
    );
    const worker = new Worker(f.workflows, provider);
    await worker.step();
    for (let i = 0; i < 5; i++) {
      await f.due();
      await worker.step();
    }
    const failed = (await f.workflows.repo.view()).jobs[0];
    assert.equal(failed.status, "failed");
    assert.equal(failed.remoteId, "remote-1");
    await f.workflows.control(failed.id, "retry", { commandId: randomUUID() });
    await f.due();
    await worker.step();
    const state = await f.workflows.repo.view();
    assert.equal(calls.submit, 1);
    assert.equal(calls.query, 6);
    assert.equal(state.jobs[0].status, "completed");
    assert.equal(state.products[0].tasks[0].versions.length, 1);
  } finally {
    await f.close();
  }
});
test("failed suite prevents all dependent image submissions", async () => {
  const f = await fixture();
  try {
    const calls = counts(),
      provider = fakeProvider(calls);
    provider.analyze = async () => {
      throw new ProviderError("invalid analysis", false, true);
    };
    await f.workflows.enqueue(randomUUID(), pairs(f.product), "workflow");
    const worker = new Worker(f.workflows, provider);
    await worker.step();
    assert.equal(await worker.step(), false);
    assert.equal(calls.submit, 0);
    assert.ok(
      (await f.workflows.repo.view()).jobs.every((j) => j.status === "failed"),
    );
  } finally {
    await f.close();
  }
});
test("legacy import preserves histories and selection while blocking unknown in-flight submissions", async () => {
  const f = await fixture();
  try {
    await f.db.query("DELETE FROM products");
    const old = newProduct("LEGACY", "已有产品", "资料") as Product,
      versionId = randomUUID();
    old.photo = png;
    old.photos = [png];
    old.tasks[0].versions.push({
      id: versionId,
      source: png,
      prompt: "old prompt",
      origin: "generated",
      createdAt: 1,
      number: 1,
    });
    old.tasks[0].primaryId = versionId;
    old.tasks[0].selectedIds = [versionId];
    old.tasks[0].promptHistory.push({ prompt: "history", createdAt: 1 });
    const workspace = await f.workflows.repo.view();
    workspace.products = [old];
    workspace.jobs = [
      {
        id: randomUUID(),
        productId: old.id,
        productName: old.name,
        taskId: old.tasks[0].id,
        kind: "image",
        role: old.tasks[0].role,
        status: "running",
        stage: "image",
        mode: "live",
        config: workspace.settings,
        createdAt: 1,
        error: "",
        prompt: "old prompt",
        referenceImages: [png],
      },
    ];
    await f.workflows.importWorkspace(randomUUID(), workspace);
    const state = await f.workflows.repo.view();
    assert.equal(state.paused, true);
    assert.deepEqual(state.products[0].tasks[0].selectedIds, [versionId]);
    assert.equal(state.products[0].tasks[0].promptHistory[0].prompt, "history");
    assert.ok(
      state.products[0].tasks[0].versions[0].source.startsWith("/api/assets/"),
    );
    assert.equal(state.jobs[0].stage, "submitting");
    await assert.rejects(
      f.workflows.control(state.jobs[0].id, "retry", {
        commandId: randomUUID(),
      }),
      /核对/,
    );
    await assert.rejects(
      f.workflows.importWorkspace(randomUUID(), workspace),
      /空工作区/,
    );
  } finally {
    await f.close();
  }
});
