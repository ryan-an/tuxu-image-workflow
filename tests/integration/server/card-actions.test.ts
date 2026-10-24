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
  loginHeaders,
} from "../../support/production.js";

for (const scenario of [
  { kind: "prompt", allMissing: false, single: true },
  { kind: "prompt-set", allMissing: true, single: false },
  { kind: "image", allMissing: true, single: true },
  { kind: "workflow", allMissing: false, single: false },
  { kind: "full-workflow", allMissing: true, single: false },
])
  test(`${scenario.kind} completes with ${scenario.allMissing ? "all" : "some"} optional references missing`, async () => {
    const f = await fixture();
    try {
      await f.workflows.edit(
        f.product.tasks.flatMap((task, index) => [
          ...(scenario.allMissing || index % 2 === 0
            ? [
                {
                  path: [
                    "products",
                    f.product.id,
                    "tasks",
                    task.id,
                    "references",
                  ],
                  before: task.references,
                  value: [],
                },
              ]
            : []),
          ...(scenario.kind === "image"
            ? [
                {
                  path: ["products", f.product.id, "tasks", task.id, "prompt"],
                  before: "",
                  value: `已有提示词：${task.role}`,
                },
              ]
            : []),
        ]),
      );
      const targets = scenario.single
        ? pairs(f.product).slice(0, 1)
        : pairs(f.product);
      const promptOnly = ["prompt", "prompt-set"].includes(scenario.kind);
      const imageCount = promptOnly ? 0 : targets.length;
      const analysisCount = scenario.kind === "image" ? 0 : 1;
      const response = await f.app.inject({
        method: "POST",
        url: "/api/jobs",
        headers: await loginHeaders(f.app),
        payload: {
          commandId: randomUUID(),
          pairs: targets,
          kind: scenario.kind,
        },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().count, analysisCount + imageCount);
      const calls = counts(),
        provider = fakeProvider(calls);
      const analyze = provider.analyze,
        submit = provider.submit;
      provider.analyze = async (...args) => {
        assert.equal(args[0].tasks.length, targets.length);
        assert.equal(args[0].tasks[0].references.length, 0);
        return analyze(...args);
      };
      provider.submit = async (...args) => {
        assert.ok(args[0].trim());
        assert.deepEqual(args[1], [f.product.photo]);
        return submit(...args);
      };
      const worker = new Worker(f.workflows, provider, () => {});
      for (let index = 0; index < analysisCount + imageCount * 2; index++) {
        await f.due();
        assert.equal(await worker.step(), true);
      }
      const state = await f.workflows.repo.view();
      assert.ok(state.jobs.every((job) => job.status === "completed"));
      for (const target of targets) {
        const task = state.products[0].tasks.find(
          (item) => item.id === target.taskId,
        )!;
        assert.ok(task.prompt.trim());
        assert.equal(task.versions.length, promptOnly ? 0 : 1);
      }
      assert.deepEqual(calls, {
        analyze: analysisCount,
        submit: imageCount,
        query: imageCount,
      });
    } finally {
      await f.close();
    }
  });

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
    product.tasks[0].references = [];
    const withoutReference = await analyze();
    assert.equal(withoutReference.prompts.length, 1);
    assert.equal(
      request.input[0].content.filter((c: any) => c.type === "input_image")
        .length,
      1,
    );
    assert.ok(request.input[0].content[0].text.includes("对标图是可选资料"));
    assert.ok(
      request.input[0].content.some((c: any) =>
        c.text?.includes("未提供对标图，请依据产品资料"),
      ),
    );
    extra = true;
    await assert.rejects(analyze(), /完整1张/);
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});
