import test from "node:test";
import assert from "node:assert/strict";
import { newProduct } from "../../../shared/model.js";
import { productsNewestFirst } from "../../../shared/product-order.js";
import { productPage } from "../../../src/view-models/product-page.js";
import { WorkspaceClient } from "../../../src/services/workspace-client.js";
import { emptyWorkspace } from "../../../server/production/repository.js";

test("creation time orders products before search and pagination without changing source rows", () => {
  const products = Array.from({ length: 65 }, (_, index) => ({
    ...newProduct(`P${String(64 - index).padStart(2, "0")}`, "同名产品"),
    createdAt: index + 1,
    createdOrder: index + 1,
  }));
  const original = products.map((p) => p.id);
  const state: any = { products };
  const ui: any = { search: "", productPage: 1 };
  assert.deepEqual(
    productPage(state, ui).products.map((p) => p.createdAt),
    Array.from({ length: 30 }, (_, i) => 65 - i),
  );
  assert.equal(
    productPage(state, { ...ui, productPage: 2 }).products[0].createdAt,
    35,
  );
  assert.equal(
    productPage(state, { ...ui, search: "同名", productPage: 3 }).products[0]
      .createdAt,
    5,
  );
  assert.deepEqual(
    products.map((p) => p.id),
    original,
    "view ordering must not move persisted sheet rows",
  );
});

test("same-time and legacy products use database insertion order instead of their codes", () => {
  const products = [
    { ...newProduct("Z-OLD"), createdAt: 0, createdOrder: 1 },
    { ...newProduct("A-NEW"), createdAt: 0, createdOrder: 2 },
    { ...newProduct("B-SAME-TIME"), createdAt: 123, createdOrder: 3 },
    { ...newProduct("Y-SAME-TIME"), createdAt: 123, createdOrder: 4 },
  ];
  assert.deepEqual(
    productsNewestFirst(products).map((p) => p.code),
    ["Y-SAME-TIME", "B-SAME-TIME", "A-NEW", "Z-OLD"],
  );
});

test("save acknowledgements and full refreshes retain chronological sidebar order", async () => {
  const state = emptyWorkspace();
  const old = { ...newProduct("A-OLD"), createdAt: 1, createdOrder: 1 };
  const newest = { ...newProduct("Z-NEW"), createdAt: 2, createdOrder: 2 };
  state.products = [old, newest] as any;
  const client = new WorkspaceClient(state, {
    render() {},
    sync() {},
    notify() {},
  });
  const result = client.savedWorkspace({
    editResult: "delta",
    products: [{ ...old, facts: "更新旧产品资料" }],
    document: {},
    cursor: 3,
  });
  assert.equal(result.products[0].id, newest.id);
  await client.accept(result);
  assert.equal(state.products[0].id, newest.id);
  await client.accept({ ...state, products: [old, newest] });
  assert.equal(state.products[0].id, newest.id);
});
