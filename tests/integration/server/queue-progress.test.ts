import test from "node:test";
import assert from "node:assert/strict";
import { newProduct, addVersion } from "../../../shared/model.js";
import { fixture, loginHeaders } from "../../support/production.js";
import type { Product } from "../../../server/production/types.js";
import { WorkspaceDirectory } from "../../../server/production/workspace-directory.js";

test("global product progress returns 30 lightweight rows, full totals and workspace-wide filters", async () => {
  const f = await fixture();
  try {
    const config = (await f.workflows.repo.view()).settings;
    await f.db.transaction(async (tx) => {
      await tx.query("DELETE FROM products");
      for (let index = 0; index < 65; index++) {
        const product = newProduct(
          `Q${String(index).padStart(3, "0")}`,
          `产品${index}`,
        ) as Product;
        product.photo = f.product.photo;
        product.photos = [f.product.photo];
        product.tasks[0].prompt = "PRIVATE-PROMPT-MUST-NOT-BE-LOADED";
        if (index === 0) {
          addVersion(product.tasks[0], f.product.photo, "first");
          addVersion(product.tasks[0], f.product.photo, "second");
        }
        if (index === 1)
          for (const task of product.tasks)
            addVersion(task, f.product.photo, "ready");
        await f.workflows.repo.saveProduct(tx, product);
        if (index >= 2 && index <= 4)
          await f.workflows.repo.insertJob(tx, {
            id: `job-${index}`,
            productId: product.id,
            productName: product.name,
            taskId: product.tasks[0].id,
            kind: "image",
            role: "尺寸图",
            mode: "live",
            status:
              index === 2 ? "failed" : index === 3 ? "queued" : "interrupted",
            stage: "pending",
            createdAt: index,
            error: "",
            config,
          });
      }
    });
    assert.equal(
      (await f.app.inject({ url: "/api/queue/products" })).statusCode,
      401,
    );
    const headers = await loginHeaders(f.app);
    const read = async (query = "") => {
      const response = await f.app.inject({
        url: `/api/queue/products${query}`,
        headers,
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.ok(!response.body.includes("PRIVATE-PROMPT"));
      return response.json();
    };
    const first = await read(),
      second = await read("?page=2"),
      third = await read("?page=999");
    assert.equal(first.total, 65);
    assert.equal(first.products.length, 30);
    assert.equal(third.page, 3);
    assert.equal(third.products.length, 5);
    assert.equal(
      new Set(
        [...first.products, ...second.products, ...third.products].map(
          (row) => row.product.id,
        ),
      ).size,
      65,
    );
    assert.equal(first.summary.slots, 650);
    assert.equal(first.summary.completeProducts, 1);
    assert.equal(first.summary.activeProducts, 1);
    assert.equal(first.summary.attentionProducts, 2);
    assert.equal(first.summary.generated, 11);
    assert.equal(first.summary.selected, 11);
    assert.equal(first.summary.failed, 1);
    assert.equal(first.summary.interrupted, 1);
    assert.equal(first.summary.pending, 1);
    assert.equal(first.products[0].info.generated, 1);
    assert.equal(first.products[0].info.picked, 1);
    assert.equal(first.products[0].product._summary, true);
    assert.equal(first.products[0].product.tasks[0].versions, undefined);
    for (const [status, total] of [
      ["missing", 63],
      ["partial", 1],
      ["complete", 1],
      ["ready", 1],
      ["selected", 1],
      ["attention", 2],
      ["active", 1],
    ]) {
      const filtered = await read(`?status=${status}`);
      assert.equal(filtered.total, total);
      assert.deepEqual(filtered.summary, first.summary);
    }
    const found = await read("?page=3&search=Q061");
    assert.equal(found.page, 1);
    assert.equal(found.products[0].product.code, "Q061");
    const empty = await read("?page=999&search=missing");
    assert.equal(empty.page, 1);
    assert.equal(empty.total, 0);
    assert.deepEqual(empty.summary, first.summary);
    assert.equal((await read("?pageSize=3000")).products.length, 30);
    for (const query of ["?page=0", "?status=invalid"])
      assert.equal(
        (await f.app.inject({ url: `/api/queue/products${query}`, headers }))
          .statusCode,
        400,
      );
    const other = await new WorkspaceDirectory(f.db).create(
      "owner",
      "独立工作区",
    );
    const isolated = await f.app.inject({
      url: "/api/queue/products",
      headers: { ...headers, "x-workspace-id": other.id },
    });
    assert.equal(isolated.statusCode, 200);
    assert.equal(isolated.json().summary.products, 0);
  } finally {
    await f.close();
  }
});
