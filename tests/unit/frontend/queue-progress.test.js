import test from "node:test";
import assert from "node:assert/strict";
import { newProduct, addVersion } from "../../../shared/model.js";
import {
  queueProgress,
  productQueueInfo,
} from "../../../shared/queue-progress.js";

test("product progress paginates summaries with global totals independent of filters", () => {
  const products = Array.from({ length: 65 }, (_, i) =>
    newProduct(`P${i}`, `产品${i}`),
  );
  addVersion(products[40].tasks[0], "image", "ready");
  addVersion(products[40].tasks[0], "image", "second");
  const state = { products, jobs: [], paused: false, concurrency: 2 };
  const first = queueProgress(state),
    second = queueProgress(state, 2);
  assert.equal(first.products.length, 30);
  assert.equal(second.products.length, 30);
  assert.equal(queueProgress(state, 99).products.length, 5);
  assert.equal(queueProgress(state, 99).page, 3);
  assert.equal(first.summary.completeProducts, 0);
  assert.equal(first.summary.selected, 1);
  assert.equal(first.summary.generated, 1);
  assert.deepEqual(first.summary, second.summary);
  const search = queueProgress(state, 3, "partial", "P40");
  assert.equal(search.page, 1);
  assert.equal(search.total, 1);
  assert.equal(search.products[0].product.id, products[40].id);
  assert.deepEqual(search.summary, first.summary);
  const empty = queueProgress(state, 9, "selected");
  assert.equal(empty.total, 0);
  assert.equal(empty.page, 1);
  assert.deepEqual(empty.summary, first.summary);
});

test("key totals count image positions and unique products rather than versions or attempts", () => {
  const products = [
    newProduct("complete"),
    newProduct("partial"),
    newProduct("empty"),
  ];
  for (const task of products[0].tasks) {
    addVersion(task, "first", "prompt");
    addVersion(task, "second", "prompt");
  }
  addVersion(products[1].tasks[0], "image", "prompt");
  const job = (id, product, index, status, createdAt = 1) => ({
    id,
    productId: product.id,
    taskId: product.tasks[index].id,
    kind: "image",
    status,
    createdAt,
  });
  const state = {
    products,
    jobs: [
      job("failure", products[0], 0, "failed"),
      job("failure-2", products[0], 3, "failed"),
      job("running", products[0], 1, "running"),
      job("queued", products[0], 2, "queued"),
      job("other", products[2], 0, "queued"),
      job("old-failure", products[1], 0, "failed"),
      job("recovered", products[1], 0, "completed", 2),
    ],
  };
  const result = queueProgress(state);
  assert.equal(result.summary.generated, 11);
  assert.equal(result.summary.selected, 11);
  assert.equal(result.summary.completeProducts, 1);
  assert.equal(result.summary.activeProducts, 2);
  assert.equal(result.summary.attentionProducts, 1);
  const complete = queueProgress(state, 1, "complete");
  assert.equal(complete.total, 1);
  assert.equal(complete.products[0].product.id, products[0].id);
  assert.deepEqual(complete.summary, result.summary);
});

test("compact and full products have identical progress including selection and execution", () => {
  const product = newProduct("P1");
  addVersion(product.tasks[0], "image", "ready");
  addVersion(product.tasks[0], "image", "second");
  const compact = {
    ...product,
    _summary: true,
    tasks: product.tasks.map(({ id, versions, selectedIds }) => ({
      id,
      selectedIds,
      versionCount: versions.length,
    })),
  };
  const state = { jobs: [], paused: false };
  assert.deepEqual(
    productQueueInfo(state, compact),
    productQueueInfo(state, product),
  );
  const job = {
    id: "failed",
    kind: "image",
    productId: product.id,
    taskId: product.tasks[0].id,
    status: "failed",
    createdAt: 1,
  };
  state.jobs.push(job);
  assert.equal(productQueueInfo(state, compact).label, "待重试");
  const overview = queueProgress(
    { ...state, products: [compact] },
    1,
    "attention",
  );
  assert.equal(overview.total, 1);
  assert.equal(overview.products[0].retryable, 1);
});

test("opening a product from global progress locates its sidebar page and clears navigation search", async () => {
  const { createCommands } = await import(
    "../../../src/application/commands.js"
  );
  const products = Array.from({ length: 65 }, (_, i) => newProduct(`P${i}`));
  const state = { products };
  const ui = { search: "another product", productPage: 1 };
  let loaded;
  const commands = createCommands({
    state,
    ui,
    currentProduct: () => products[0],
    setFilter() {},
    render() {},
    saveSoon() {},
    repository: {
      loadProducts: async (ids) => {
        loaded = ids;
      },
    },
    switchView: async (view) => assert.equal(view, "workbench"),
  });
  await commands.action("queue-open-product", { id: products[61].id });
  assert.equal(ui.search, "");
  assert.equal(ui.productPage, 3);
  assert.equal(state.activeProductId, products[61].id);
  assert.deepEqual(loaded, [products[61].id]);
});
