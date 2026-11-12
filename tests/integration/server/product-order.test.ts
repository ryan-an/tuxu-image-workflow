import test from "node:test";
import assert from "node:assert/strict";
import { fixture, loginHeaders } from "../../support/production.js";
import { newProduct } from "../../../shared/model.js";
import { productsNewestFirst } from "../../../shared/product-order.js";
import type { Product } from "../../../server/production/types.js";

test("creation metadata survives summaries, detail reads, deltas, edits and restart, including legacy insertion order", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const since = await f.workflows.repo.cursor();
    const old = { ...newProduct("Z-OLD"), createdAt: 100 };
    const recent = { ...newProduct("A-RECENT"), createdAt: 200 };
    const sameTime = { ...newProduct("M-SAME-TIME"), createdAt: 200 };
    const legacyOld: Product = newProduct("Y-LEGACY-OLD");
    const legacyNew: Product = newProduct("B-LEGACY-NEW");
    delete legacyOld.createdAt;
    delete legacyNew.createdAt;
    await f.db.transaction(async (tx) => {
      await tx.query("DELETE FROM products");
      for (const product of [old, recent, sameTime])
        await f.workflows.repo.saveProduct(tx, product);
      for (const product of [legacyOld, legacyNew])
        await tx.query(
          "INSERT INTO products(id,workspace_id,code,document) VALUES($1,$2,$3,$4)",
          [product.id, "default", product.code, product],
        );
    });
    const expected = [
      sameTime.id,
      recent.id,
      old.id,
      legacyNew.id,
      legacyOld.id,
    ];
    const order = (products: Product[]) =>
      productsNewestFirst(products).map((p) => p.id);
    const full = (
      await f.app.inject({ url: "/api/workspace", headers })
    ).json();
    assert.deepEqual(order(full.products), expected);
    const metadata = new Map<string, any>(
      full.products.map((p: Product) => [p.id, [p.createdAt, p.createdOrder]]),
    );
    for (const url of [
      "/api/workspace/startup",
      `/api/workspace/changes?since=${since}`,
      `/api/workspace/products?ids=${expected.join(",")}`,
    ]) {
      const response = await f.app.inject({ url, headers });
      assert.equal(response.statusCode, 200, response.body);
      const products = response.json().products;
      assert.deepEqual(order(products), expected);
      for (const product of products)
        assert.deepEqual(
          [product.createdAt, product.createdOrder],
          metadata.get(product.id),
        );
    }
    const saved = await f.app.inject({
      method: "PATCH",
      url: "/api/workspace",
      headers: { ...headers, "x-workspace-result": "delta" },
      payload: {
        edits: [
          {
            path: ["products", old.id, "name"],
            before: old.name,
            value: "修改旧产品",
          },
        ],
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(
      [
        saved.json().products[0].createdAt,
        saved.json().products[0].createdOrder,
      ],
      metadata.get(old.id),
    );
    const forbidden = await f.app.inject({
      method: "PATCH",
      url: "/api/workspace",
      headers,
      payload: {
        edits: [
          {
            path: ["products", old.id, "createdAt"],
            before: 100,
            value: Date.now(),
          },
        ],
      },
    });
    assert.equal(forbidden.statusCode, 400);
    await f.db.transaction(async (tx) => {
      const legacy = (
        await f.workflows.repo.productsById(tx, [legacyOld.id])
      )[0];
      await f.workflows.repo.saveProduct(tx, {
        ...legacy,
        name: "修改旧资料",
        createdAt: Date.now(),
      });
    });
    await f.reopen();
    const reopened = await f.workflows.repo.view();
    assert.deepEqual(order(reopened.products), expected);
    for (const product of reopened.products)
      assert.deepEqual(
        [product.createdAt, product.createdOrder],
        metadata.get(product.id),
      );
  } finally {
    await f.close();
  }
});
