import SQLite from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Database, Queryable } from "./types.js";

const jsonColumns = new Set(["document", "payload", "response"]);
function bind(value: any): string | number | bigint | Buffer | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return Number(value);
  return value;
}

// Network calls run concurrently outside transactions. Database operations are
// serialized so awaited writes cannot interleave within one transaction.
export function database(filename: string): Database {
  if (filename !== ":memory:")
    mkdirSync(dirname(resolve(filename)), { recursive: true });
  const connection = new SQLite(filename, { timeout: 5000 });
  connection.pragma("foreign_keys = ON");
  connection.pragma("journal_mode = WAL");
  connection.pragma("synchronous = FULL");
  let chain = Promise.resolve(),
    closed = false;
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = chain.catch(() => {}).then(work);
    chain = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  const tx: Queryable = {
    async query(sql, values) {
      if (closed) throw new Error("SQLite 数据库已关闭");
      if (!values && /;\s*\S/.test(sql)) {
        connection.exec(sql);
        return { rows: [], rowCount: 0 };
      }
      const statement = connection.prepare(sql);
      // SQLite supports named $1, $2 bindings, including repeated parameters.
      const parameters = Object.fromEntries(
        (values || []).map((value, index) => [String(index + 1), bind(value)]),
      );
      if (statement.reader) {
        const rows = (statement.all(parameters) as Record<string, any>[]).map(
          (row) => {
            for (const name of jsonColumns)
              if (typeof row[name] === "string")
                row[name] = JSON.parse(row[name]);
            return row;
          },
        );
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: Number(statement.run(parameters).changes) };
    },
  };
  return {
    query: (sql, values) => serialize(() => tx.query(sql, values)),
    transaction: (work) =>
      serialize(async () => {
        if (closed) throw new Error("SQLite 数据库已关闭");
        connection.exec("BEGIN IMMEDIATE");
        try {
          const result = await work(tx);
          connection.exec("COMMIT");
          return result;
        } catch (error) {
          connection.exec("ROLLBACK");
          throw error;
        }
      }),
    close: () =>
      serialize(async () => {
        if (!closed) {
          connection.close();
          closed = true;
        }
      }),
  };
}

export async function migrate(db: Database) {
  const directory = new URL("./sqlite-migrations/", import.meta.url);
  const files = (await readdir(directory))
    .filter((name) => /^\d+\.sql$/.test(name))
    .sort();
  await db.transaction(async (tx) => {
    await tx.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)))",
    );
    for (const file of files) {
      const sql = await readFile(new URL(file, directory), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const row = (
        await tx.query(
          "SELECT checksum FROM schema_migrations WHERE version=$1",
          [file],
        )
      ).rows[0];
      if (row) {
        if (row.checksum !== checksum)
          throw new Error(`已执行迁移 ${file} 内容发生变化，请新增迁移文件`);
        continue;
      }
      await tx.query(sql);
      await tx.query(
        "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
        [file, checksum],
      );
    }
  });
}
