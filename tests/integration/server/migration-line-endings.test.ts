import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { database, migrate } from "../../../server/production/database.js";

const hash = (sql: string) => createHash("sha256").update(sql).digest("hex");
const migration = (name: string) =>
  readFile(
    new URL(
      `../../../server/production/sqlite-migrations/${name}`,
      import.meta.url,
    ),
    "utf8",
  );

for (const ending of ["LF", "CRLF"] as const) {
  test(`${ending} migration history upgrades without rerunning SQL or replacing checksums`, async () => {
    const db = database(":memory:");
    try {
      await db.query(
        "CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL DEFAULT 123)",
      );
      for (let number = 1; number <= 13; number++) {
        const name = `${String(number).padStart(3, "0")}.sql`;
        const lf = (await migration(name)).replace(/\r\n/g, "\n");
        const sql = ending === "CRLF" ? lf.replace(/\n/g, "\r\n") : lf;
        await db.query(sql);
        await db.query(
          "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
          [name, hash(sql)],
        );
      }
      const history = (
        await db.query("SELECT * FROM schema_migrations ORDER BY version")
      ).rows;
      await migrate(db);
      assert.deepEqual(
        (
          await db.query(
            "SELECT * FROM schema_migrations WHERE version <= '013.sql' ORDER BY version",
          )
        ).rows,
        history,
      );
      assert.deepEqual((await db.query("PRAGMA foreign_key_check")).rows, []);
      await migrate(db);
      assert.deepEqual(
        (
          await db.query(
            "SELECT * FROM schema_migrations WHERE version <= '013.sql' ORDER BY version",
          )
        ).rows,
        history,
      );

      // A real SQL edit still fails, and the surrounding transaction rolls back.
      const changed = (await migration("001.sql")).replace(
        "CREATE TABLE workspace",
        "CREATE TABLE changed_workspace",
      );
      await db.query(
        "UPDATE schema_migrations SET checksum=$1 WHERE version='001.sql'",
        [hash(changed)],
      );
      await db.query("DELETE FROM schema_migrations WHERE version='018.sql'");
      await assert.rejects(migrate(db), /已执行迁移 001.sql 内容发生变化/);
      assert.equal(
        (
          await db.query(
            "SELECT count(*) AS count FROM schema_migrations WHERE version='018.sql'",
          )
        ).rows[0].count,
        0,
      );
    } finally {
      await db.close();
    }
  });
}

test("CRLF legacy sheet-import migration relocates while preserving its checksum and timestamp", async () => {
  const db = database(":memory:");
  try {
    await db.query(
      "CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL DEFAULT 123)",
    );
    for (let number = 1; number <= 7; number++) {
      const name = `${String(number).padStart(3, "0")}.sql`;
      const sql = await migration(name);
      await db.query(sql);
      await db.query(
        "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
        [name, hash(sql)],
      );
    }
    const sql = (await migration("014.sql"))
      .replace(/\r\n/g, "\n")
      .replace(/\n/g, "\r\n");
    await db.query(sql);
    await db.query(
      "INSERT INTO schema_migrations(version,checksum) VALUES('008.sql',$1)",
      [hash(sql)],
    );
    await migrate(db);
    assert.deepEqual(
      (
        await db.query(
          "SELECT checksum,applied_at FROM schema_migrations WHERE version='014.sql'",
        )
      ).rows[0],
      { checksum: hash(sql), applied_at: 123 },
    );
    await migrate(db);
    assert.deepEqual((await db.query("PRAGMA foreign_key_check")).rows, []);
  } finally {
    await db.close();
  }
});
