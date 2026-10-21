import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  parseSuiteResponse,
  productSpecs,
} from "../../../shared/prompt-suite.js";
import { newProduct, taskStatusInfo } from "../../../shared/model.js";
import { GrsaiProvider } from "../../../server/production/provider.js";
import { Worker } from "../../../server/production/worker.js";
import { fixture, pairs } from "../../support/production.js";

const plateName =
  "2个陶瓷餐盘乳白色外尺寸37cmx12cm内尺寸32cmx7.5cm品牌：Enjamyo";
const plateCopy = [
  "Smooth Surface",
  "Stackable Design",
  "2PCS",
  "Outer: 37cm x 12cm",
  "Inner: 32cm x 7.5cm",
];

test("dimension annotations retain all inner/outer measurements and compact units and pack quantities validate", () => {
  const product = newProduct("plates", plateName);
  product.tasks = product.tasks.slice(0, 1);
  assert.deepEqual(
    new Set(productSpecs(product).measurements.map((m: any) => m.number)),
    new Set(["37", "12", "32", "7.5"]),
  );
  const response = {
    style: "统一风格",
    images: [{ role: "尺寸图", layout: "尺寸线", copy: plateCopy }],
  };
  const result = parseSuiteResponse(JSON.stringify(response), 6, product);
  assert.equal(result.prompts.length, 1);
  assert.match(result.prompts[0].prompt, /2PCS/);
  assert.equal("warnings" in result, false);
  for (const copy of [
    ["短"],
    ["one two three four five six seven eight nine ten eleven"],
  ]) {
    assert.equal(
      parseSuiteResponse(
        JSON.stringify({
          ...response,
          images: [{ ...response.images[0], copy }],
        }),
        6,
        product,
      ).prompts.length,
      1,
    );
  }

  const compact = newProduct("compact", "2个盘外尺寸37x12cm内尺寸32x7.5cm");
  assert.deepEqual(
    new Set(productSpecs(compact).measurements.map((m: any) => m.number)),
    new Set(["37", "12", "32", "7.5"]),
  );
});

test("complete suite saves all ten prompts and final text without content checks or warnings", async () => {
  const f = await fixture(),
    originalFetch = globalThis.fetch;
  try {
    await f.workflows.edit([
      {
        path: ["products", f.product.id, "name"],
        before: f.product.name,
        value: plateName,
      },
      {
        path: ["products", f.product.id, "facts"],
        before: f.product.facts,
        value: "",
      },
    ]);
    await f.workflows.enqueue(randomUUID(), pairs(f.product), "prompt-set");
    const text = JSON.stringify({
      style: "统一风格",
      images: f.product.tasks.map(({ role }, i) => ({
        role,
        layout: "版面布局",
        copy:
          i === 0
            ? plateCopy
            : i === 6
              ? ["Enjamyo Made For Your Everyday Needs"]
              : ["Thoughtful Design For Your Everyday Needs"],
        fourthPart: "分辨率300",
        photoIndices: [1, 2],
      })),
    });
    globalThis.fetch = async () =>
      new Response(
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text.slice(0, -10) })}\n\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: text.slice(-10) })}\n\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }] } })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    const logs: any[] = [];
    await new Worker(
      f.workflows,
      new GrsaiProvider(f.workflows.assets),
      (event) => logs.push(event),
    ).step();
    await f.reopen();
    const state = await f.workflows.repo.view(),
      job = state.jobs[0];
    assert.equal(job.status, "completed");
    assert.equal(job.error, "");
    assert.equal(job.analysisResponse, text);
    assert.equal(job.receivedChars, text.length);
    assert.match(job.promptDrafts!["A+ 4"], /分辨率300$/);
    assert.equal(job.promptWarnings, undefined);
    assert.ok(
      state.products[0].tasks.every(
        (task) =>
          task.prompt && taskStatusInfo(task, state.jobs).label === "待生图",
      ),
    );
    assert.equal(state.products[0].promptSets.length, 1);
    assert.equal(logs[0].event, "prompt.completed");
    assert.equal(logs[0].promptCount, 10);
    assert.equal(logs[0].warnings, undefined);
    assert.doesNotMatch(
      JSON.stringify(logs),
      /版面布局|fake-doubao-key|base64|Smooth Surface/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await f.close();
  }
});

test("mandatory validation failure retains final response and logs the rule and card without prompt text", async () => {
  const f = await fixture(),
    originalFetch = globalThis.fetch;
  try {
    await f.workflows.enqueue(
      randomUUID(),
      pairs(f.product).slice(0, 1),
      "workflow",
    );
    const text = JSON.stringify({
      style: "统一风格",
      images: [
        {
          role: "尺寸图",
          layout: "",
          copy: ["Thoughtful Design For Your Everyday Needs"],
          fourthPart: "分辨率300",
        },
      ],
    });
    globalThis.fetch = async () =>
      Response.json({
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text }] }],
      });
    const logs: any[] = [];
    const worker = new Worker(
      f.workflows,
      new GrsaiProvider(f.workflows.assets),
      (event) => logs.push(event),
    );
    await worker.step();
    await worker.step();
    const state = await f.workflows.repo.view(),
      job = state.jobs.find((j) => j.kind === "prompt-set")!;
    assert.equal(job.status, "failed");
    assert.equal(job.analysisResponse, text);
    assert.match(job.promptDrafts!["尺寸图"], /分辨率300$/);
    assert.deepEqual(job.validationError, {
      code: "invalid_card",
      role: "尺寸图",
    });
    assert.deepEqual(logs[0].validation, job.validationError);
    assert.ok(state.jobs.every((j) => j.status === "failed"));
    assert.doesNotMatch(
      JSON.stringify(logs),
      /private layout|fake-doubao-key|base64/,
    );
    await f.workflows.control(job.id, "retry");
    const retried = (await f.workflows.repo.view()).jobs.find(
      (j) => j.id === job.id,
    )!;
    assert.equal(retried.analysisResponse, undefined);
    assert.equal(retried.promptDrafts, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    await f.close();
  }
});

