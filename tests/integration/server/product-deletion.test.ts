import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, loginHeaders, pairs } from "../../support/production.js";
import { workflowSnapshot } from "../../../shared/sheet-data.js";
import { AssistantConversations } from "../../../server/production/assistant-conversations.js";

test("deleting a product removes its history and sheet rows, preserves shared assets and publishes tombstones", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const storage = new AssistantConversations(f.db);
    await storage.create({ productId: f.product.id }, [
      { role: "user", content: "旧问题" },
    ]);
    const general = await storage.create({});
    await f.workflows.enqueue(randomUUID(), pairs(f.product), "workflow");
    await f.db.transaction(async (tx) => {
      const state = await f.workflows.repo.view(tx);
      for (const job of state.jobs) {
        job.status = "cancelled";
        await f.workflows.repo.saveJob(tx, job);
        await tx.query(
          "INSERT INTO job_attempts(id,job_id,stage,outcome) VALUES($1,$2,'pending','cancelled')",
          [randomUUID(), job.id],
        );
      }
      const other = structuredClone(state.products[0]);
      other.id = randomUUID();
      other.code = "KEEP-02";
      other.tasks.forEach((task) => (task.id = randomUUID()));
      await f.workflows.repo.saveProduct(tx, other);
      state.products.push(other);
      state.sheetSnapshot = workflowSnapshot(state);
      await f.workflows.repo.saveWorkspace(tx, state);
    });
    const cursor = await f.workflows.repo.cursor();
    const url = `/api/products/${f.product.id}`;
    assert.equal(
      (await f.app.inject({ method: "DELETE", url })).statusCode,
      401,
    );
    const response = await f.app.inject({ method: "DELETE", url, headers });
    assert.equal(response.statusCode, 200, response.body);
    const after = response.json();
    assert.equal(after.products.length, 1);
    assert.equal(after.products[0].code, "KEEP-02");
    assert.equal(after.jobs.length, 0);
    assert.ok(!JSON.stringify(after.sheetSnapshot).includes(f.product.id));
    assert.ok(JSON.stringify(after.sheetSnapshot).includes("KEEP-02"));
    assert.equal(
      (await f.db.query("SELECT * FROM job_attempts")).rows.length,
      0,
    );
    assert.deepEqual(
      (await storage.list({})).map((c) => c.id),
      [general.id],
    );
    assert.equal((await storage.list({ productId: f.product.id })).length, 0);
    assert.ok(
      (await f.workflows.assets.get(f.product.photo.split("/").at(-1)!)).bytes
        .length,
    );
    const delta = await f.db.transaction((tx) =>
      f.workflows.repo.changes(tx, cursor),
    );
    assert.deepEqual(delta.deletedProducts, [f.product.id]);
    assert.ok(delta.deletedJobs!.length > 0);
    assert.equal(
      (await f.app.inject({ method: "DELETE", url, headers })).statusCode,
      404,
    );
  } finally {
    await f.close();
  }
});

test("active or uncertain jobs and streaming consultation block deletion without modifying data", async () => {
  const f = await fixture();
  try {
    await f.workflows.enqueue(
      randomUUID(),
      pairs(f.product).slice(0, 1),
      "prompt",
    );
    for (const status of ["queued", "running", "interrupted"] as const) {
      await f.db.transaction(async (tx) => {
        const job = (await f.workflows.repo.view(tx)).jobs[0];
        job.status = status;
        await f.workflows.repo.saveJob(tx, job);
      });
      await assert.rejects(
        f.workflows.deleteProduct(f.product.id),
        /先取消或处理/,
      );
      assert.equal((await f.workflows.repo.view()).products.length, 1);
    }
    await f.db.query("UPDATE jobs SET status='cancelled'");
    const storage = new AssistantConversations(f.db);
    const conversation = await storage.create({ productId: f.product.id });
    await storage.start(conversation.id, randomUUID(), "问题", "test-model");
    await assert.rejects(f.workflows.deleteProduct(f.product.id), /先停止/);
    assert.equal((await f.workflows.repo.view()).products.length, 1);
  } finally {
    await f.close();
  }
});
