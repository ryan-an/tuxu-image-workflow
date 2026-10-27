import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { database, migrate } from "../../../server/production/database.js";
import {
  Repository,
  emptyWorkspace,
} from "../../../server/production/repository.js";
import { newProduct } from "../../../shared/model.js";

const checksum = (sql: string) =>
  createHash("sha256").update(sql).digest("hex");
const migration = (name: string) =>
  readFile(
    new URL(
      `../../../server/production/sqlite-migrations/${name}`,
      import.meta.url,
    ),
    "utf8",
  );

test("015 databases discard unscoped cooldowns while preserving credentials and queued retry times", async () => {
  const db = database(":memory:");
  try {
    await db.query(
      "CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL DEFAULT 123)",
    );
    for (let number = 1; number <= 15; number++) {
      const name = `${String(number).padStart(3, "0")}.sql`;
      const sql = await migration(name);
      await db.query(sql);
      await db.query(
        "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
        [name, checksum(sql)],
      );
    }
    const repo = new Repository(db);
    await repo.initialize();
    await db.query(
      "UPDATE workspace SET credential='encrypted-version' WHERE id='default'",
    );
    const product = newProduct("preserved-product");
    await repo.saveProduct(db, product);
    await repo.insertJob(db, {
      id: "preserved-job",
      productId: product.id,
      productName: product.name,
      kind: "prompt-set",
      status: "queued",
      stage: "pending",
      mode: "live",
      role: "all",
      createdAt: 123,
      error: "",
      config: emptyWorkspace().settings,
      rateLimitUntil: 900000,
      rateLimitRetries: 1,
    });
    await db.query("UPDATE jobs SET due_at=900000 WHERE id='preserved-job'");
    await db.query(
      "INSERT INTO model_cooldowns VALUES('doubao','model',900000)",
    );
    await migrate(db);
    assert.equal(
      (await db.query("SELECT COUNT(*) AS count FROM model_cooldowns")).rows[0]
        .count,
      0,
    );
    assert.equal(
      (await db.query("SELECT credential FROM workspace WHERE id='default'"))
        .rows[0].credential,
      "encrypted-version",
    );
    const job = (
      await db.query("SELECT due_at,payload FROM jobs WHERE id='preserved-job'")
    ).rows[0];
    assert.equal(job.due_at, 900000);
    assert.equal(job.payload.rateLimitUntil, 900000);
    assert.equal(job.payload.rateLimitRetries, 1);
    await repo.deferModel(db, "doubao", "model", 950000, "version-hash");
    assert.equal(
      (
        await db.query(
          "SELECT workspace_id,credential_version FROM model_cooldowns",
        )
      ).rows[0].workspace_id,
      "default",
    );
    await migrate(db);
    assert.deepEqual((await db.query("PRAGMA foreign_key_check")).rows, []);
  } finally {
    await db.close();
  }
});

for (const source of ["local-sheet-import", "remote-accounts"] as const) {
  test(`${source} databases upgrade without losing workspace data or pending imports`, async () => {
    const db = database(":memory:");
    try {
      await db.query(
        "CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL DEFAULT 123)",
      );
      const limit = source === "local-sheet-import" ? 7 : 13;
      for (let number = 1; number <= limit; number++) {
        const name = `${String(number).padStart(3, "0")}.sql`;
        const sql = await migration(name);
        await db.query(sql);
        await db.query(
          "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
          [name, checksum(sql)],
        );
      }
      const { products, jobs, ...document } = emptyWorkspace();
      document.concurrency = 4;
      delete document.promptConcurrency;
      delete document.queryConcurrency;
      await db.query(
        "INSERT INTO workspace(id,document,credential,prompt_credential) VALUES('default',$1,'preserved-image-key','preserved-prompt-key')",
        [document],
      );
      if (source === "local-sheet-import") {
        const sql = await migration("014.sql");
        await db.query(sql);
        await db.query(
          "INSERT INTO schema_migrations(version,checksum) VALUES('008.sql',$1)",
          [checksum(sql)],
        );
        await db.query(
          "INSERT INTO sheet_imports VALUES('pending-import','default',$1,9999999999999)",
          [{ candidates: [{ code: "PRESERVE-ME" }] }],
        );
      }
      await migrate(db);
      assert.deepEqual((await db.query("PRAGMA foreign_key_check")).rows, []);
      const workspace = (
        await db.query("SELECT * FROM workspace WHERE id='default'")
      ).rows[0];
      assert.equal(workspace.credential, "preserved-image-key");
      assert.equal(workspace.prompt_credential, "preserved-prompt-key");
      assert.deepEqual(workspace.document, {
        ...document,
        promptConcurrency: 15,
        queryConcurrency: 8,
      });
      assert.equal(
        (await db.query("SELECT count(*) AS count FROM schema_migrations"))
          .rows[0].count,
        16,
      );
      await db.query("SELECT * FROM accounts");
      await db.query("SELECT * FROM workspace_members");
      if (source === "local-sheet-import") {
        assert.equal(
          (
            await db.query(
              "SELECT document FROM sheet_imports WHERE id='pending-import'",
            )
          ).rows[0].document.candidates[0].code,
          "PRESERVE-ME",
        );
        const relocated = (
          await db.query(
            "SELECT * FROM schema_migrations WHERE version='014.sql'",
          )
        ).rows[0];
        assert.equal(relocated.checksum, checksum(await migration("014.sql")));
        assert.equal(relocated.applied_at, 123);
      }
      await migrate(db);
      assert.equal(
        (await db.query("SELECT count(*) AS count FROM schema_migrations"))
          .rows[0].count,
        16,
      );
      await db.query(
        "UPDATE schema_migrations SET checksum='unexpected' WHERE version='008.sql'",
      );
      await assert.rejects(migrate(db), /已执行迁移 008.sql 内容发生变化/);
    } finally {
      await db.close();
    }
  });
}
