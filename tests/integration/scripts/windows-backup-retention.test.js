import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, access, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const { artifactPath } = createRequire(import.meta.url)(resolve("tests/support/artifacts.cjs"));
let executable;
async function harness() {
  if (executable) return executable;
  const directory = artifactPath("backup-retention/compiler-" + randomUUID());
  await mkdir(directory, { recursive: true });
  executable = join(directory, "retention.exe");
  const result = spawnSync(join(process.env.SystemRoot || "C:/Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe"), [
    "/nologo", "/target:exe", "/reference:System.Web.Extensions.dll", "/out:" + executable,
    resolve("scripts/windows/BackupRetention.cs"), resolve("tests/support/backup-retention.cs"),
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return executable;
}
async function fixture() {
  const root = artifactPath("backup-retention/" + randomUUID());
  const history = join(root, "data/backups");
  await mkdir(history, { recursive: true });
  await writeFile(join(root, ".env"), "original configuration");
  await writeFile(join(root, "data/live.sqlite"), "live data must survive");
  let sequence = 0;
  const snapshot = async (state, time) => {
    const path = join(history, "update-20261027-120000-" + (++sequence).toString(16).padStart(8, "0"));
    await mkdir(join(path, "data"), { recursive: true });
    await mkdir(join(path, "program"));
    await writeFile(join(path, "data/saved.bin"), "backup bytes");
    await writeFile(join(path, "update.json"), JSON.stringify({ state, time, version: "0.2.2", buildId: "20261027T080000000Z" }));
    return path;
  };
  const prune = async (current, locked) => {
    const result = spawnSync(await harness(), [history, current, ...(locked ? [locked] : [])], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(root, ".env"), "utf8"), "original configuration");
    assert.equal(await readFile(join(root, "data/live.sqlite"), "utf8"), "live data must survive");
    return result.stdout.trim();
  };
  return { root, history, snapshot, prune };
}
const options = { skip: process.platform !== "win32", timeout: 30000 };
test("backup retention pins the current snapshot, keeps one recent success and protects failed or unknown backups", options, async () => {
  const f = await fixture();
  const current = await f.snapshot("complete", "2020-01-01T00:00:00Z");
  const oldest = await f.snapshot("complete", "2021-01-01T00:00:00Z");
  const middle = await f.snapshot("complete", "2022-01-01T00:00:00Z");
  const latest = await f.snapshot("complete", "2023-01-01T00:00:00Z");
  const protectedPaths = [];
  for (const state of ["restore-required", "backing-up", "backup-complete", "program-restored"])
    protectedPaths.push(await f.snapshot(state, "2019-01-01T00:00:00Z"));
  const malformed = await f.snapshot("complete", "2019-01-01T00:00:00Z");
  await writeFile(join(malformed, "update.json"), "invalid json");
  protectedPaths.push(malformed);
  const personal = join(f.history, "my-manual-backup");
  await mkdir(personal);
  protectedPaths.push(personal);
  assert.equal(await f.prune(current), "");
  for (const path of [current, latest, ...protectedPaths]) await access(path);
  await assert.rejects(access(oldest));
  await assert.rejects(access(middle));
});
test("backup retention never prunes before the current update has completed", options, async () => {
  const f = await fixture();
  const old = [];
  for (const year of [2020, 2021, 2022]) old.push(await f.snapshot("complete", year + "-01-01T00:00:00Z"));
  const pending = await f.snapshot("backup-complete", "2023-01-01T00:00:00Z");
  assert.match(await f.prune(pending), /状态未确认/);
  for (const path of [...old, pending]) await access(path);
});
test("locked old backups report cleanup warnings while recent snapshots and live data survive", options, async () => {
  const f = await fixture();
  const locked = await f.snapshot("complete", "2020-01-01T00:00:00Z");
  const recent = await f.snapshot("complete", "2021-01-01T00:00:00Z");
  const current = await f.snapshot("complete", "2022-01-01T00:00:00Z");
  assert.match(await f.prune(current, join(locked, "data/saved.bin")), /暂未完全清理/);
  for (const path of [current, recent, locked]) await access(path);
});
test("backup cleanup refuses nested junctions and never follows them outside the backup", options, async () => {
  const f = await fixture();
  const old = await f.snapshot("complete", "2020-01-01T00:00:00Z");
  await f.snapshot("complete", "2021-01-01T00:00:00Z");
  const current = await f.snapshot("complete", "2022-01-01T00:00:00Z");
  const outside = join(f.root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "keep.txt"), "outside data");
  await symlink(outside, join(old, "data/junction"), "junction");
  assert.match(await f.prune(current), /暂未完全清理/);
  assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "outside data");
  await access(old);
});
