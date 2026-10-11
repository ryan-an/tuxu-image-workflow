import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fixture, fakeProvider, counts, pairs } from "./test-support.js";
import { migrate } from "./database.js";
import { Worker } from "./worker.js";

test("SQLite transactions roll back and concurrent readers never see uncommitted writes", async () => {
  const f = await fixture();
  try {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const id = randomUUID();
    const transaction = f.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO commands(id,fingerprint,response) VALUES($1,$2,$3)",
        [id, "test", { value: "temporary" }],
      );
      entered();
      await gate;
      throw new Error("rollback");
    });
    await started;
    let readFinished = false;
    const reader = f.db
      .query("SELECT * FROM commands WHERE id=$1", [id])
      .then((result) => {
        readFinished = true;
        return result;
      });
    await Promise.resolve();
    assert.equal(readFinished, false);
    const rejected = assert.rejects(transaction, /rollback/);
    release();
    await rejected;
    assert.equal((await reader).rows.length, 0);
    await migrate(f.db);
    assert.equal(
      (await f.db.query("SELECT * FROM schema_migrations")).rows.length,
      1,
    );
    await assert.rejects(
      f.db.query(
        "INSERT INTO products(id,workspace_id,code,document) VALUES($1,$2,$3,$4)",
        [randomUUID(), "missing", "invalid", {}],
      ),
      /FOREIGN KEY/,
    );
  } finally {
    await f.close();
  }
});

test("SQLite file reopen retains credentials, workspace rules, images and command deduplication", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await readFile(f.filename)).subarray(0, 16).toString(),
      "SQLite format 3\0",
    );
    await f.workflows.edit([
      {
        path: ["common"],
        before: (await f.workflows.repo.view()).common,
        value: "我的持久规则",
      },
    ]);
    const commandId = randomUUID(),
      calls = counts(),
      provider = fakeProvider(calls);
    await f.workflows.enqueue(commandId, pairs(f.product), "workflow");
    const worker = new Worker(f.workflows, provider);
    for (let i = 0; i < 21; i++) {
      await f.due();
      await worker.step();
    }
    const before = await f.workflows.repo.view();
    await f.reopen();
    const after = await f.workflows.repo.view();
    assert.deepEqual(after, before);
    assert.equal(await f.workflows.key(), "fake-platform-key");
    assert.equal(
      (await f.workflows.enqueue(commandId, pairs(f.product), "workflow"))
        .count,
      11,
    );
    assert.equal((await f.workflows.repo.view()).jobs.length, 11);
    const response = await f.app.inject({
      method: "GET",
      url: after.products[0].tasks[0].versions[0].source,
      headers: {
        authorization: `Basic ${Buffer.from("admin:test-password-123456789").toString("base64")}`,
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "image/png");
    assert.deepEqual(calls, { analyze: 1, submit: 10, query: 10 });
  } finally {
    await f.close();
  }
});
