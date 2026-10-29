import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const { artifactPath } = createRequire(import.meta.url)(
  resolve("tests/support/artifacts.cjs"),
);

test("migration builds contain only current SQL files with stable line endings", async () => {
  const root = artifactPath(`migration-build/${randomUUID()}`);
  const destination = join(root, "server/production/sqlite-migrations");
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, "999.sql"), "obsolete migration");
  await writeFile(join(destination, "README.txt"), "unrelated file");
  const result = spawnSync(
    process.execPath,
    [resolve("scripts/copy-migrations.mjs"), root],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const source = resolve("server/production/sqlite-migrations");
  const files = (await readdir(source))
    .filter((name) => /^\d+\.sql$/.test(name))
    .sort();
  assert.deepEqual(
    (await readdir(destination))
      .filter((name) => /^\d+\.sql$/.test(name))
      .sort(),
    files,
  );
  for (const file of files) {
    assert.equal(
      await readFile(join(destination, file), "utf8"),
      (await readFile(join(source, file), "utf8")).replace(/\r\n/g, "\n"),
    );
  }
  assert.equal(
    await readFile(join(destination, "README.txt"), "utf8"),
    "unrelated file",
  );
});
