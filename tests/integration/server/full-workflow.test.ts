import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  fixture,
  pairs,
  fakeProvider,
  counts,
  loginHeaders,
} from "../../support/production.js";
import { Worker } from "../../../server/production/worker.js";

test("explicit full workflow regenerates ready prompts before dependent image submission", async () => {
  const f = await fixture();
  try {
    await f.workflows.edit(
      f.product.tasks.map((task) => ({
        path: ["products", f.product.id, "tasks", task.id, "prompt"],
        before: "",
        value: "原有提示词",
      })),
    );
    const response = await f.app.inject({
      method: "POST",
      url: "/api/jobs",
      headers: await loginHeaders(f.app),
      payload: {
        commandId: randomUUID(),
        pairs: pairs(f.product),
        kind: "full-workflow",
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().count, 11);
    const state = await f.workflows.repo.view(),
      analysis = state.jobs.find((job) => job.kind === "prompt-set")!;
    assert.ok(
      state.jobs
        .filter((job) => job.kind === "image")
        .every((job) => job.dependsOn === analysis.id),
    );
    const calls = counts(),
      provider = fakeProvider(calls);
    let submitted = "";
    const submit = provider.submit.bind(provider);
    provider.submit = async (prompt, ...args) => {
      submitted = prompt;
      return submit(prompt, ...args);
    };
    const worker = new Worker(f.workflows, provider, () => {});
    await worker.step();
    assert.equal(calls.analyze, 1);
    assert.equal(calls.submit, 0);
    await worker.step();
    assert.match(submitted, /^prompt:/);
    assert.ok(
      (await f.workflows.repo.view()).products[0].tasks.every((task) =>
        task.prompt.startsWith("prompt:"),
      ),
    );
  } finally {
    await f.close();
  }
});
