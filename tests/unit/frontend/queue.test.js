import { queueJobWorking } from "../../../shared/job-status.js";
import test from "node:test";
import assert from "node:assert/strict";
import { GenerationQueue } from "../../../src/demo/queue.js";
import {
  newProduct,
  addVersion,
  selectVersion,
  hasSelectedVersion,
  taskStatusInfo,
} from "../../../shared/model.js";
import { DEFAULT_COMMON, demoSuite } from "../../../shared/prompt-suite.js";
import {
  latestQueueJobs,
  productQueueInfo,
  retryableQueueJobs,
} from "../../../shared/queue-progress.js";
const photo = "data:image/png;base64,real-product";
function setup() {
  const product = newProduct(
    "test",
    "25 个装信封",
    "24 cm x 28 cm\n品牌：Blcculi",
  );
  product.photo = photo;
  product.tasks.forEach(
    (task, i) => (task.references = [`data:image/png;base64,competitor-${i}`]),
  );
  const state = {
    products: [product],
    jobs: [],
    settings: { mode: "live" },
    common: DEFAULT_COMMON,
    concurrency: 6,
    paused: false,
  };
  const writes = [];
  const queue = new GenerationQueue(state, {
    change() {},
    notify() {},
    sync: async (p, t, kind) => writes.push({ taskId: t.id, kind }),
    persist: async () => {},
  });
  return {
    product,
    state,
    queue,
    writes,
    pairs: product.tasks.map((task) => ({ product, task })),
  };
}
async function until(condition) {
  for (let n = 0; n < 100; n++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("queue did not finish");
}

test("local live queue accepts optional references for prompts, images and full workflows", () => {
  for (const kind of [
    "prompt",
    "prompt-set",
    "image",
    "workflow",
    "full-workflow",
  ])
    for (const allMissing of [false, true]) {
      const { product, state, queue, pairs } = setup();
      state.paused = true;
      product.tasks.forEach((task, index) => {
        if (allMissing || index % 2 === 0) task.references = [];
        if (kind === "image") task.prompt = `已有提示词：${task.role}`;
      });
      const promptOnly = ["prompt", "prompt-set"].includes(kind);
      assert.equal(
        queue.enqueue(pairs, kind),
        promptOnly ? 1 : kind === "image" ? 10 : 11,
      );
      if (kind !== "image")
        assert.equal(
          state.jobs[0].productSnapshot.tasks[0].references.length,
          0,
        );
      for (const job of state.jobs.filter((item) => item.kind === "image"))
        assert.deepEqual(job.referenceImages, [photo]);
    }
});

test("local analysis snapshots each product's requirements and reset returns to defaults", () => {
  const { product, state, queue, pairs } = setup();
  state.paused = true;
  product.promptRequirements = "本产品独立要求";
  queue.enqueue(pairs.slice(0, 1), "prompt");
  const job = state.jobs[0];
  assert.equal(job.common, "本产品独立要求");
  product.promptRequirements = "编辑后的要求";
  assert.equal(job.common, "本产品独立要求");
  job.status = "failed";
  queue.retry(job.id);
  assert.equal(job.common, "编辑后的要求");
  product.promptRequirements = null;
  queue.enqueue(pairs.slice(1, 2), "prompt");
  assert.equal(state.jobs[1].common, state.common);
  const other = newProduct("other");
  other.photo = photo;
  other.tasks[0].references = [photo];
  state.products.push(other);
  queue.enqueue([{ product: other, task: other.tasks[0] }], "prompt");
  assert.equal(state.jobs[2].common, state.common);
});

test("single card analysis writes only its prompt and single card workflow submits one image", async () => {
  const original = globalThis.fetch;
  const { product, state, queue, writes, pairs } = setup();
  let analyses = 0,
    images = 0;
  globalThis.fetch = async (url, options) => {
    const input = JSON.parse(options.body);
    if (url.endsWith("prompt-set")) {
      analyses++;
      assert.deepEqual(
        input.product.tasks.map((t) => t.id),
        [product.tasks[2].id],
      );
      return Response.json(demoSuite(input.product));
    }
    images++;
    return Response.json({
      id: `image-${images}`,
      status: "succeeded",
      image: photo,
    });
  };
  try {
    assert.equal(queue.enqueue(pairs.slice(2, 3), "workflow"), 2);
    await until(() => state.jobs.every((j) => j.status === "completed"));
    assert.equal(analyses, 1);
    assert.equal(images, 1);
    assert.ok(
      product.tasks
        .filter((_, i) => i !== 2)
        .every(
          (t) => !t.prompt && !t.promptHistory.length && !t.versions.length,
        ),
    );
    assert.deepEqual(writes, [
      { taskId: product.tasks[2].id, kind: "prompt" },
      { taskId: product.tasks[2].id, kind: "result" },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});
test("one set request gates ten images, and image references contain only real photos", async () => {
  const original = globalThis.fetch;
  const { product, state, queue, writes, pairs } = setup();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let sets = 0,
    images = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("prompt-set")) {
      sets++;
      await gate;
      return Response.json(demoSuite(product));
    }
    const input = JSON.parse(options.body);
    images++;
    assert.deepEqual(input.referenceImages, [photo]);
    assert.ok(input.prompt.includes("第三部份"));
    return Response.json({
      id: `image-${images}`,
      status: "succeeded",
      image: photo,
    });
  };
  try {
    assert.equal(queue.enqueue(pairs), 11);
    assert.equal(queue.enqueue(pairs), 0);
    await until(() => sets === 1);
    assert.equal(images, 0);
    product.tasks[0].prompt = "用户在执行期间修改";
    product.tasks[0].revision++;
    release();
    await until(() => state.jobs.every((j) => j.status === "completed"));
    assert.equal(sets, 1);
    assert.equal(images, 10);
    assert.equal(product.tasks[0].prompt, "用户在执行期间修改");
    assert.equal(product.tasks[0].promptHistory.length, 1);
    assert.ok(product.tasks.every((t) => t.versions.length === 1));
    assert.equal(writes.filter((w) => w.kind === "prompt").length, 10);
    assert.equal(writes.filter((w) => w.kind === "result").length, 10);
  } finally {
    globalThis.fetch = original;
  }
});
test("set failure prevents image submissions, and retry resumes dependent images", async () => {
  const original = globalThis.fetch;
  const { product, state, queue, pairs } = setup();
  let sets = 0,
    images = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith("prompt-set")) {
      sets++;
      return sets === 1
        ? Response.json({ error: "分析失败" }, { status: 400 })
        : Response.json(demoSuite(product));
    }
    images++;
    return Response.json({
      id: `image-${images}`,
      status: "succeeded",
      image: photo,
    });
  };
  try {
    queue.enqueue(pairs);
    await until(() => state.jobs.every((j) => j.status === "failed"));
    assert.equal(sets, 1);
    assert.equal(images, 0);
    queue.retry(state.jobs.find((j) => j.kind === "prompt-set").id);
    await until(() => state.jobs.every((j) => j.status === "completed"));
    assert.equal(sets, 2);
    assert.equal(images, 10);
  } finally {
    globalThis.fetch = original;
  }
});

test("queue status keeps separate card analyses and shows accepted polling jobs as working", () => {
  const { state, product, queue, pairs } = setup();
  state.paused = true;
  queue.enqueue(pairs.slice(0, 1), "prompt");
  queue.enqueue(pairs.slice(1, 2), "prompt");
  state.jobs[0].status = "failed";
  state.jobs[1].status = "completed";
  assert.equal(latestQueueJobs(state).length, 2);
  assert.equal(productQueueInfo(state, product).label, "待重试");
  assert.deepEqual(
    retryableQueueJobs(state).map((j) => j.id),
    [state.jobs[0].id],
  );
  const image = queue.newJob(product, "image", {
    taskId: product.tasks[0].id,
    remoteId: "accepted",
    stage: "polling",
  });
  assert.equal(queueJobWorking(image), true);
  assert.equal(productQueueInfo(state, product).label, "生成中");
});

test("bulk retry excludes uncertain requests and failed dependency children", () => {
  const { state, queue, pairs } = setup();
  state.paused = true;
  queue.enqueue(pairs, "workflow");
  state.jobs.forEach((j) => (j.status = "failed"));
  const parent = state.jobs[0];
  assert.deepEqual(
    retryableQueueJobs(state).map((j) => j.id),
    [parent.id],
  );
  parent.stage = "analyzing";
  assert.equal(retryableQueueJobs(state).length, 0);
  parent.status = "completed";
  assert.equal(retryableQueueJobs(state).length, 10);
});

test("bulk cancellation does not dispatch between cancellations and preserves polling jobs", () => {
  const { state, queue, product, pairs } = setup();
  state.paused = true;
  product.tasks.forEach((t) => (t.prompt = "ready"));
  queue.enqueue(pairs, "image");
  state.jobs[0].remoteId = "accepted";
  state.paused = false;
  let started = 0;
  queue.run = () => {
    started++;
  };
  queue.cancelPending();
  assert.equal(state.jobs.filter((j) => j.status === "cancelled").length, 9);
  assert.equal(started, 1); // Only the already accepted job may continue polling.
  state.paused = true;
  queue.cancelProduct(product.id);
  assert.equal(state.paused, true);
  assert.ok(state.jobs.every((j) => j.status === "cancelled"));
});

test("interrupted local image can retry and remote recovery preserves queue pause", () => {
  const { state, queue, product, pairs } = setup();
  state.paused = true;
  product.tasks[0].prompt = "ready";
  queue.enqueue(pairs.slice(0, 1), "image");
  state.jobs[0].status = "interrupted";
  queue.retry(state.jobs[0].id);
  assert.equal(state.jobs.length, 2);
  assert.equal(state.jobs[1].status, "queued");
  state.jobs[1].status = "failed";
  state.jobs[1].remoteId = "original-request";
  state.jobs[0].status = "cancelled";
  queue.retry(state.jobs[1].id);
  assert.equal(state.jobs.length, 2);
  assert.equal(state.jobs[1].remoteId, "original-request");
  assert.equal(state.jobs[1].status, "queued");
  assert.equal(state.paused, true);
});

test("product retry command only recovers failed jobs belonging to the requested product", async () => {
  const { createCommands } = await import(
    "../../../src/application/commands.js"
  );
  const { state, product, queue } = setup();
  const other = newProduct("other");
  state.products.push(other);
  const target = queue.newJob(product, "image", {
    taskId: product.tasks[0].id,
    status: "failed",
  });
  queue.newJob(other, "image", { taskId: other.tasks[0].id, status: "failed" });
  const retried = [];
  const commands = createCommands({
    state,
    ui: {},
    currentProduct: () => product,
    queue: { retry: async (id) => retried.push(id), pump: async () => {} },
    change() {},
    notify() {},
  });
  await commands.action("retry-product-failed", { id: product.id });
  assert.deepEqual(retried, [target.id]);
});

test("new generated results select the latest version and unchecking only changes selection, not preview", () => {
  const { product, state } = setup();
  const task = product.tasks[0];
  const old = addVersion(task, photo, "first");
  assert.deepEqual(task.selectedIds, [old.id]);
  const latest = addVersion(task, photo, "second");
  assert.equal(task.primaryId, latest.id);
  assert.deepEqual(task.selectedIds, [latest.id]);
  selectVersion(task, latest.id, false);
  assert.equal(task.primaryId, latest.id);
  assert.equal(hasSelectedVersion(task), false);
  assert.equal(taskStatusInfo(task).label, "待选图");
  assert.equal(productQueueInfo(state, product).label, "待选图");
  assert.equal(productQueueInfo(state, product).tone, "ready");
  selectVersion(task, old.id, true);
  assert.equal(productQueueInfo(state, product).label, "部分完成");
  assert.equal(productQueueInfo(state, product).tone, "partial");
  for (const target of product.tasks.slice(1))
    addVersion(target, photo, "ready");
  assert.equal(productQueueInfo(state, product).label, "已选完成");
  assert.equal(productQueueInfo(state, product).tone, "done");
  for (const target of product.tasks) target.selectedIds = [];
  assert.equal(productQueueInfo(state, product).label, "待选图");
  assert.equal(productQueueInfo(state, product).picked, 0);
});

test("card and product execution states agree for polling, retry, interruption and pause", () => {
  const { product, state, queue } = setup();
  const task = product.tasks[0];
  addVersion(task, photo, "ready");
  const job = queue.newJob(product, "image", {
    taskId: task.id,
    remoteId: "original",
    stage: "polling",
  });
  for (const [status, label, tone] of [
    ["queued", "生成中", "working"],
    ["failed", "待重试", "error"],
    ["interrupted", "待恢复", "waiting"],
  ]) {
    job.status = status;
    assert.equal(taskStatusInfo(task, state.jobs).label, label);
    assert.equal(taskStatusInfo(task, state.jobs).tone, tone);
    assert.equal(productQueueInfo(state, product).label, label);
  }
  job.remoteId = undefined;
  job.status = "queued";
  state.paused = true;
  assert.equal(taskStatusInfo(task, state.jobs, state.paused).label, "已暂停");
  assert.equal(productQueueInfo(state, product).label, "已暂停");
});
