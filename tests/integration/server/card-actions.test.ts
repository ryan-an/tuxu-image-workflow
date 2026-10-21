import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Worker } from "../../../server/production/worker.js";
import {
  GrsaiProvider,
  ProviderError,
} from "../../../server/production/provider.js";
import {
  fixture,
  fakeProvider,
  counts,
  pairs,
} from "../../support/production.js";

test("reanalyzing one card after a failed suite leaves sibling cards and jobs untouched", async () => {
  const f = await fixture();
  try {
    await f.workflows.enqueue(randomUUID(), pairs(f.product), "workflow");
    const failed = fakeProvider(counts());
    failed.analyze = async () => {
      throw new ProviderError("分析失败", false, true);
    };
    await new Worker(f.workflows, failed, () => {}).step();
    await new Worker(f.workflows, failed, () => {}).step();
    const before = await f.workflows.repo.view();
    const calls = counts(),
      provider = fakeProvider(calls);
    assert.equal(
      (
        await f.workflows.enqueue(
          randomUUID(),
          pairs(f.product).slice(2, 3),
          "prompt",
        )
      ).count,
      1,
    );
    await new Worker(f.workflows, provider).step();
    const after = await f.workflows.repo.view();
    assert.deepEqual(
      after.products[0].tasks.filter((_, i) => i !== 2),
      before.products[0].tasks.filter((_, i) => i !== 2),
    );
    assert.deepEqual(
      after.jobs.filter((job) => before.jobs.some((old) => old.id === job.id)),
      before.jobs,
    );
    assert.equal(after.products[0].tasks[2].prompt, "prompt:细节图");
    assert.deepEqual(calls, { analyze: 1, submit: 0, query: 0 });
  } finally {
    await f.close();
  }
});

test("generating a card without a prompt analyzes and updates only that card", async () => {
  const f = await fixture();
  try {
    await f.workflows.edit(
      f.product.tasks.slice(1).map((task) => ({
        path: ["products", f.product.id, "tasks", task.id, "references"],
        before: task.references,
        value: [],
      })),
    );
    const before = (await f.workflows.repo.view()).products[0].tasks.slice(1);
    assert.equal(
      (
        await f.workflows.enqueue(
          randomUUID(),
          pairs(f.product).slice(0, 1),
          "workflow",
        )
      ).count,
      2,
    );
    const calls = counts(),
      worker = new Worker(f.workflows, fakeProvider(calls));
    for (let i = 0; i < 3; i++) {
      await f.due();
      assert.equal(await worker.step(), true);
    }
    const state = await f.workflows.repo.view();
    assert.deepEqual(state.products[0].tasks.slice(1), before);
    assert.equal(state.products[0].tasks[0].versions.length, 1);
    assert.deepEqual(calls, { analyze: 1, submit: 1, query: 1 });
    assert.ok(state.jobs.every((j) => j.status === "completed"));
  } finally {
    await f.close();
  }
});

test("independent card analyses coexist and ready image generation has no unrelated analysis dependency", async () => {
  const f = await fixture();
  try {
    await f.workflows.enqueue(
      randomUUID(),
      pairs(f.product).slice(0, 1),
      "prompt",
    );
    await f.workflows.enqueue(
      randomUUID(),
      pairs(f.product).slice(1, 2),
      "prompt",
    );
    const task = f.product.tasks[2];
    await f.workflows.edit([
      {
        path: ["products", f.product.id, "tasks", task.id, "prompt"],
        before: "",
        value: "手动提示词",
      },
    ]);
    await f.workflows.enqueue(
      randomUUID(),
      pairs(f.product).slice(2, 3),
      "image",
    );
    const jobs = (await f.workflows.repo.view()).jobs;
    assert.equal(jobs.length, 3);
    assert.ok(
      jobs
        .filter((j) => j.kind === "prompt-set")
        .every(
          (j) =>
            j.taskIds?.length === 1 && j.productSnapshot?.tasks.length === 1,
        ),
    );
    assert.equal(jobs.find((j) => j.kind === "image")?.dependsOn, undefined);
  } finally {
    await f.close();
  }
});

test("card reanalysis after an interrupted suite creates a separate scoped task", async () => {
  const f = await fixture();
  try {
    await f.workflows.enqueue(randomUUID(), pairs(f.product), "prompt");
    await f.db.transaction(async (tx) => {
      const job = (await f.workflows.repo.view(tx)).jobs[0];
      job.status = "interrupted";
      job.stage = "analyzing";
      await f.workflows.repo.saveJob(tx, job);
    });
    assert.equal(
      (
        await f.workflows.enqueue(
          randomUUID(),
          pairs(f.product).slice(0, 1),
          "prompt",
        )
      ).count,
      1,
    );
    const calls = counts();
    await new Worker(f.workflows, fakeProvider(calls)).step();
    const state = await f.workflows.repo.view();
    assert.equal(state.jobs[0].status, "interrupted");
    assert.equal(state.products[0].tasks[0].prompt, "prompt:尺寸图");
    assert.ok(
      state.products[0].tasks
        .slice(1)
        .every((t) => !t.prompt && !t.promptHistory.length),
    );
  } finally {
    await f.close();
  }
});

test("single card model request includes only its reference and accepts only its role", async () => {
  const f = await fixture(),
    original = globalThis.fetch;
  try {
    const product = { ...f.product, tasks: [f.product.tasks[2]] };
    let request: any;
    let extra = false;
    globalThis.fetch = async (_url, options) => {
      request = JSON.parse(String(options?.body));
      const image = {
        role: "细节图",
        layout: "准确展示实拍产品",
        copy: ["Thoughtful Design For Your Everyday Packing"],
        photoIndices: [0],
      };
      return Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  style: "统一留白布局",
                  images: extra
                    ? [image, { ...image, role: "场景 1" }]
                    : [image],
                }),
              },
            ],
          },
        ],
      });
    };
    const state = await f.workflows.repo.view(),
      provider = new GrsaiProvider(f.workflows.assets);
    const analyze = () =>
      provider.analyze(
        product,
        state.common,
        state.settings,
        "test-key",
        new AbortController().signal,
      );
    const result = await analyze();
    assert.deepEqual(
      result.prompts.map((p: any) => p.role),
      ["细节图"],
    );
    assert.equal(
      request.input[0].content.filter((c: any) => c.type === "input_image")
        .length,
      2,
    );
    assert.ok(request.input[0].content[0].text.includes("images必须恰好1项"));
    extra = true;
    await assert.rejects(analyze(), /完整1张/);
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});
