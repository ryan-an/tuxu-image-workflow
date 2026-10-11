import test from "node:test";
import assert from "node:assert/strict";
import { fixture, pairs, fakeProvider, counts } from "./test-support.js";
import { Worker } from "./worker.js";
test("task diagnostics retain transport code while hiding credentials", async () => {
  const f = await fixture();
  try {
    await f.workflows.enqueue(
      "transport-diagnostics",
      pairs(f.product),
      "prompt-set",
    );
    const provider = fakeProvider(counts());
    provider.analyze = async () => {
      throw new Error("fetch failed fake-platform-key", {
        cause: { code: "UND_ERR_HEADERS_TIMEOUT" },
      });
    };
    const logs: any[] = [];
    await new Worker(f.workflows, provider, (event) => logs.push(event)).step();
    const job = (await f.workflows.repo.view()).jobs[0];
    assert.equal(job.status, "interrupted");
    assert.match(job.error, /UND_ERR_HEADERS_TIMEOUT/);
    assert.doesNotMatch(job.error, /fake-platform-key/);
    assert.ok(job.finishedAt);
    assert.equal(logs[0].transportCode, "UND_ERR_HEADERS_TIMEOUT");
    assert.doesNotMatch(JSON.stringify(logs), /fake-platform-key/);
  } finally {
    await f.close();
  }
});
