import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  pairs,
  fakeProvider,
  counts,
  loginHeaders,
} from "../../support/production.js";
import { editable, differences } from "../../../shared/workspace-edits.js";
import { Worker } from "../../../server/production/worker.js";

test("invalid sheet selection returns a traceable validation warning without image or prompt data", async (t) => {
  const f = await fixture();
  try {
    const warnings: any[] = [];
    t.mock.method(f.app.log, "warn", (...args: any[]) => warnings.push(args));
    const state = await f.workflows.repo.view();
    const draft = structuredClone(state);
    draft.products[0].tasks[0].primaryId = "missing-history";
    const response = await f.app.inject({
      method: "PATCH",
      url: "/api/workspace",
      headers: await loginHeaders(f.app),
      payload: { edits: differences(editable(state), editable(draft)) },
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /尺寸图/);
    const diagnostic = warnings.find(
      ([entry]) => entry.event === "product.validation.failed",
    )?.[0];
    assert.equal(diagnostic.productId, state.products[0].id);
    assert.equal(diagnostic.requestId, response.json().requestId);
    assert.ok(diagnostic.reasons.includes("primary_not_in_history"));
    assert.doesNotMatch(
      JSON.stringify(warnings),
      /base64|fake-platform-key|fake-doubao-key/,
    );
  } finally {
    await f.close();
  }
});
test("task diagnostics retain transport code while hiding credentials", async () => {
  const f = await fixture();
  try {
    await f.workflows.enqueue(
      "transport-diagnostics",
      pairs(f.product),
      "prompt-set",
    );
    const provider = fakeProvider(counts());
    provider.analyze = async (_product, _common, _config, key) => {
      throw new Error(`fetch failed ${key}`, {
        cause: { code: "UND_ERR_HEADERS_TIMEOUT" },
      });
    };
    const logs: any[] = [];
    await new Worker(f.workflows, provider, (event) => logs.push(event)).step();
    const job = (await f.workflows.repo.view()).jobs[0];
    assert.equal(job.status, "interrupted");
    assert.match(job.error, /UND_ERR_HEADERS_TIMEOUT/);
    assert.doesNotMatch(job.error, /fake-platform-key|fake-doubao-key/);
    assert.ok(job.finishedAt);
    assert.equal(logs[0].transportCode, "UND_ERR_HEADERS_TIMEOUT");
    assert.doesNotMatch(
      JSON.stringify(logs),
      /fake-platform-key|fake-doubao-key/,
    );
  } finally {
    await f.close();
  }
});
