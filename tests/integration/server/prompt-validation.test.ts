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
    images: [{ role: "尺寸图", prompt: plateCopy.join("\n") }],
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
          images: [{ ...response.images[0], prompt: copy.join("\n") }],
        }),
        6,
        product,
      ).prompts.length,
      1,
    );
  }

  for (const prompt of [undefined, null, 1, "", " \r\n\t"]) {
    assert.throws(
      () =>
        parseSuiteResponse(
          JSON.stringify({
            images: [
              {
                role: "尺寸图",
                prompt,
                layout: "不能补齐",
                copy: ["不能拼接"],
              },
            ],
          }),
          6,
          product,
        ),
      (error: any) => error.code === "empty_prompt" && error.role === "尺寸图",
    );
  }
  const compact = newProduct("compact", "2个盘外尺寸37x12cm内尺寸32x7.5cm");
  assert.deepEqual(
    new Set(productSpecs(compact).measurements.map((m: any) => m.number)),
    new Set(["37", "12", "32", "7.5"]),
  );
});

test("model prompt bodies are preserved verbatim without adding, extracting or reordering sections", () => {
  const product = newProduct("verbatim");
  product.tasks = product.tasks.slice(0, 1);
  const prompt =
    '\r\n  自定义第一部份\n正文与 "引号"、反斜线 \\。\n图上文案直接写在这里。\n【指定末句】\n\n自定义第二部份\n配色\n自定义第三部份\n6：原始编号\n自定义第四部份\n任意尺寸  \r\n';
  const result = parseSuiteResponse(
    JSON.stringify({
      style: "不应添加的设计规范",
      images: [
        {
          role: "尺寸图",
          prompt,
          layout: "不应替换的布局",
          copy: ["不应追加的文案"],
          thirdPart: "不应覆盖的规则",
          fourthPart: "不应覆盖的尺寸",
        },
      ],
    }),
    0,
    product,
    "用户模板也不应被程序拼入成品",
  );
  assert.equal(result.prompts[0].prompt, prompt);
});

test("complete suite with equivalent role names saves all ten prompts and final text without content checks or warnings", async () => {
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
    const returnedRoles = [
      "尺寸图",
      "卖点图",
      "细节图",
      "场景1",
      "场景2",
      "场景3",
      "A+(1)",
      "A+(2)",
      "A+(3)",
      "A+(4)",
    ];
    const response = {
      images: f.product.tasks.map(({ role }, i) => ({
        role: returnedRoles[i],
        prompt: `  第一部分：版面布局\r\n${(i === 0
          ? plateCopy
          : i === 6
            ? ["Enjamyo Made For Your Everyday Needs"]
            : ["Thoughtful Design For Your Everyday Needs"]
        ).join(
          "\n",
        )}\n【第一部分指定末句】\n\n第二部分：统一风格\n第三部分：AI 产品约束 ${role}，按实际资料设计。\n第四部分：AI 画布1200X800，分辨率150`,
        photoIndices: [1, 2],
      })),
    };
    const text = JSON.stringify(response);
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
    assert.match(job.promptDrafts!["A+ 4"], /分辨率150$/);
    assert.deepEqual(
      Object.keys(job.promptDrafts!),
      f.product.tasks.map((t) => t.role),
    );
    assert.equal(job.promptWarnings, undefined);
    assert.ok(
      state.products[0].tasks.every(
        (task) =>
          task.prompt && taskStatusInfo(task, state.jobs).label === "待生图",
      ),
    );
    assert.equal(state.products[0].promptSets.length, 1);
    for (const [index, task] of state.products[0].tasks.entries()) {
      assert.equal(task.prompt, response.images[index].prompt);
      assert.equal(job.promptDrafts![task.role], task.prompt);
      assert.equal(job.prompts![index].prompt, task.prompt);
      assert.ok(task.prompt.includes(`AI 产品约束 ${task.role}`));
      assert.match(task.prompt, /AI 画布1200X800，分辨率150$/);
      assert.doesNotMatch(task.prompt, /1610X1610|970X600|分辨率300/);
    }
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
      images: [
        {
          role: "不存在的位置",
          prompt:
            "private layout\nThoughtful Design For Your Everyday Needs\n分辨率300",
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
    assert.deepEqual(job.promptDrafts, {});
    assert.deepEqual(job.validationError, {
      code: "invalid_card",
    });
    assert.deepEqual(
      JSON.parse(JSON.stringify(logs[0].validation)),
      job.validationError,
    );
    assert.ok(state.jobs.every((j) => j.status === "failed"));
    assert.doesNotMatch(
      JSON.stringify(logs),
      /private layout|fake-doubao-key|base64/,
    );
    await f.workflows.control(job.id, "retry", { commandId: randomUUID() });
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
