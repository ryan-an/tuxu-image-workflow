import test from "node:test";
import assert from "node:assert/strict";
import { GenerationQueue } from "./queue.js";
import { newProduct } from "./model.js";
import { DEFAULT_COMMON, demoSuite } from "./prompt-suite.js";
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
