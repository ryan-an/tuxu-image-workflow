import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GrsaiProvider } from "../../../server/production/provider.js";
import { Worker } from "../../../server/production/worker.js";
import { fixture, pairs, loginHeaders } from "../../support/production.js";

const provider = () =>
  new GrsaiProvider({
    providerSource: async (source: string) => source,
    analysisSource: async (source: string) => source,
  } as any);

test("Doubao platform reasons reach saved prompt jobs and the workspace response without credentials", async () => {
  const f = await fixture(),
    original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        `data: ${JSON.stringify({ type: "response.failed", response: { error: { code: "InsufficientBalance", message: "账户余额不足 fake-doubao-key" } } })}\n\n`,
        {
          headers: {
            "content-type": "text/event-stream",
            "x-request-id": "prompt-request",
          },
        },
      );
    await f.workflows.enqueue(randomUUID(), pairs(f.product), "prompt-set");
    await new Worker(f.workflows, provider()).step();
    const job = (await f.workflows.repo.view()).jobs[0];
    assert.equal(job.status, "failed");
    assert.match(job.error || "", /豆包提示词模型调用失败：账户余额不足/);
    assert.match(job.error || "", /InsufficientBalance.*prompt-request/);
    const response = await f.app.inject({
      url: "/api/workspace",
      headers: await loginHeaders(f.app),
    });
    assert.match(response.body, /账户余额不足/);
    assert.ok(!response.body.includes("fake-doubao-key"));
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});

test("image result reasons reach saved jobs and remain failed without a second paid submission", async () => {
  const f = await fixture(),
    original = globalThis.fetch;
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
    let submissions = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes("/v1/api/generate")) {
        submissions++;
        return Response.json({ id: "image-platform-task", status: "running" });
      }
      return Response.json({
        status: "failed",
        failure_reason: "output_moderation",
        error: "生成内容未通过审核 fake-platform-key",
      });
    };
    await f.workflows.enqueue(
      randomUUID(),
      pairs(f.product).slice(0, 1),
      "image",
    );
    const worker = new Worker(f.workflows, provider());
    await worker.step();
    await f.due();
    await worker.step();
    const job = (await f.workflows.repo.view()).jobs[0];
    assert.equal(job.status, "failed");
    assert.match(job.error || "", /生图模型调用失败：生成内容未通过审核/);
    assert.match(job.error || "", /output_moderation.*image-platform-task/);
    assert.ok(!job.error?.includes("fake-platform-key"));
    assert.equal(await worker.step(), false);
    assert.equal(submissions, 1);
    const response = await f.app.inject({
      url: "/api/workspace",
      headers: await loginHeaders(f.app),
    });
    assert.match(response.body, /生成内容未通过审核/);
    assert.ok(!response.body.includes("fake-platform-key"));
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});
