import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, pairs, loginHeaders, png } from "../../support/production.js";
import { GrsaiProvider } from "../../../server/production/provider.js";
import { Worker } from "../../../server/production/worker.js";
import { unavailableImageResult } from "../../../shared/image-result.js";

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function enqueue(f: Fixture) {
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
      value: "frozen prompt",
    },
  ]);
  await f.workflows.enqueue(
    randomUUID(),
    pairs(f.product).slice(0, 1),
    "image",
  );
  return (await f.workflows.repo.view()).jobs[0];
}
const missing = () =>
  Response.json(
    { error: "result not exist, valid for 2 hours" },
    { status: 404 },
  );

test("a temporary missing result is re-queried with the saved ID without another image submission", async (t) => {
  const f = await fixture();
  try {
    let submits = 0,
      queries = 0;
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
      if (String(url).endsWith("/v1/api/generate")) {
        submits++;
        return Response.json({ id: "original-id" });
      }
      queries++;
      assert.equal(new URL(String(url)).searchParams.get("id"), "original-id");
      if (queries === 1) return missing();
      return Response.json(
        queries === 2
          ? { status: "running", progress: 46 }
          : { status: "succeeded", results: [{ url: png }] },
      );
    });
    const original = await enqueue(f);
    const worker = new Worker(
      f.workflows,
      new GrsaiProvider(f.workflows.assets),
      () => {},
    );
    await worker.step();
    await f.due();
    await worker.step();
    let job = (await f.workflows.repo.job(original.id))!;
    assert.equal(job.status, "queued");
    assert.equal(job.remoteId, "original-id");
    assert.equal(submits, 1);
    await f.due();
    await worker.step();
    job = (await f.workflows.repo.job(original.id))!;
    assert.equal(job.progress, 46);
    assert.equal(job.error, "");
    assert.equal(job.resultUnavailable, undefined);
    await f.due();
    await worker.step();
    assert.equal(
      (await f.workflows.repo.job(original.id))!.status,
      "completed",
    );
    assert.equal(submits, 1);
    assert.equal(queries, 3);
  } finally {
    await f.close();
  }
});

test("persistent missing results stop polling and a user's retry creates one fresh job while preserving the old ID", async (t) => {
  const f = await fixture();
  try {
    let submits = 0,
      queries = 0;
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
      if (String(url).endsWith("/v1/api/generate")) {
        submits++;
        return Response.json({ id: `remote-${submits}` });
      }
      queries++;
      const id = new URL(String(url)).searchParams.get("id");
      return id === "remote-1"
        ? missing()
        : Response.json({ status: "succeeded", results: [{ url: png }] });
    });
    const original = await enqueue(f);
    const worker = new Worker(
      f.workflows,
      new GrsaiProvider(f.workflows.assets),
      () => {},
    );
    await worker.step();
    for (let i = 0; i < 5; i++) {
      await f.due();
      await worker.step();
    }
    const failed = (await f.workflows.repo.job(original.id))!;
    assert.equal(failed.status, "failed");
    assert.equal(failed.resultUnavailable, true);
    assert.equal(failed.remoteId, "remote-1");
    assert.equal(submits, 1);
    assert.equal(queries, 5);
    assert.equal(await worker.step(), false);
    // Existing saved errors have no new flag; the original platform text also works.
    delete failed.resultUnavailable;
    await f.workflows.repo.saveJob(f.db, failed);
    assert.equal(unavailableImageResult(failed), true);
    const headers = await loginHeaders(f.app);
    const request = {
      method: "POST" as const,
      url: `/api/jobs/${failed.id}/control`,
      headers,
      payload: { action: "retry", commandId: randomUUID() },
    };
    const response = await f.app.inject(request);
    assert.equal(response.statusCode, 200, response.body);
    const replacementId = response.json().restartedJobId;
    assert.ok(replacementId && replacementId !== original.id);
    assert.deepEqual((await f.app.inject(request)).json(), response.json());
    const replacement = (await f.workflows.repo.job(replacementId))!;
    assert.equal(replacement.stage, "pending");
    assert.equal(replacement.remoteId, undefined);
    assert.equal(replacement.replacesJobId, failed.id);
    assert.deepEqual(replacement.config, failed.config);
    assert.equal(replacement.prompt, "frozen prompt");
    assert.equal((await f.workflows.repo.view()).jobs.length, 2);
    assert.deepEqual(await f.workflows.repo.job(original.id), failed);
    const duplicate = await f.app.inject({
      ...request,
      payload: { action: "retry", commandId: randomUUID() },
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal((await f.workflows.repo.view()).jobs.length, 2);
    await f.due();
    await worker.step();
    await f.due();
    await worker.step();
    assert.equal(submits, 2);
    assert.equal(
      (await f.workflows.repo.job(replacementId))!.status,
      "completed",
    );
    assert.equal(
      (await f.workflows.repo.job(original.id))!.remoteId,
      "remote-1",
    );
  } finally {
    await f.close();
  }
});

test("a generic endpoint 404 clears an earlier missing-result flag and does not cause a fresh paid submission", async (t) => {
  const f = await fixture();
  try {
    let submits = 0,
      queries = 0;
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
      if (String(url).endsWith("/v1/api/generate")) {
        submits++;
        return Response.json({ id: "original-id" });
      }
      if (++queries === 1) return missing();
      return Response.json({ message: "route not found" }, { status: 404 });
    });
    const original = await enqueue(f);
    const worker = new Worker(
      f.workflows,
      new GrsaiProvider(f.workflows.assets),
      () => {},
    );
    await worker.step();
    await f.due();
    await worker.step();
    await f.due();
    await worker.step();
    const failed = (await f.workflows.repo.job(original.id))!;
    assert.equal(failed.status, "failed");
    assert.equal(unavailableImageResult(failed), false);
    await f.workflows.control(original.id, "retry", {
      commandId: randomUUID(),
    });
    await f.due();
    await worker.step();
    assert.equal(submits, 1);
    assert.equal((await f.workflows.repo.view()).jobs.length, 1);
    assert.equal(
      (await f.workflows.repo.job(original.id))!.remoteId,
      "original-id",
    );
  } finally {
    await f.close();
  }
});
