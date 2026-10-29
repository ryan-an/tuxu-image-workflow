import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile, readdir, rename, unlink } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
const { artifactPath } = createRequire(import.meta.url)(resolve("tests/support/artifacts.cjs"));

test("Windows updater preserves data and configuration, rejects live programs, and restores files on a replacement failure", {
  skip: !process.env.TUXU_WINDOWS_UPDATER || !process.env.TUXU_WINDOWS_BUNDLE,
  timeout: 240000,
}, async () => {
  const destination = artifactPath(`windows-update/${randomUUID()}`);
  await mkdir(destination, { recursive: true });
  const archive = resolve(process.env.TUXU_WINDOWS_BUNDLE);
  const updater = resolve(process.env.TUXU_WINDOWS_UPDATER);
  const updaterBytes = await readFile(updater);
  assert.equal(updaterBytes.readUInt16LE(updaterBytes.readUInt32LE(0x3c) + 24 + 68), 2, "Updater uses the Windows GUI subsystem");
  const extraction = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:TUXU_PACKAGE_ARCHIVE, $env:TUXU_PACKAGE_DESTINATION)"], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, TUXU_PACKAGE_ARCHIVE: archive, TUXU_PACKAGE_DESTINATION: destination },
  });
  assert.equal(extraction.status, 0, extraction.stderr);
  const root = join(destination, basename(archive, ".zip"));
  const legacyLicenses = join(root, "第三方许可");
  await assert.rejects(access(legacyLicenses), { code: "ENOENT" });
  await access(join(root, "runtime/licenses/AntdUI-Apache-2.0.txt"));
  const node = join(root, "runtime/node.exe");
  const manifestPath = join(root, "manifest.json");
  const next = JSON.parse(await readFile(manifestPath, "utf8"));
  const previous = { ...next, buildId: "20000101T000000000Z" };
  await writeFile(manifestPath, JSON.stringify(previous));
  await mkdir(join(root, "data/assets"), { recursive: true });
  const env = "HOST=127.0.0.1\nPORT=3001\nDATABASE_PATH=./data/workspace.sqlite\nASSET_DIRECTORY=./data/assets\nCREDENTIAL_SECRET=" + "12".repeat(32) + "\nAPP_PASSWORD=preserve-test-password\nTLS_CERT_FILE=\nTLS_KEY_FILE=\n";
  await writeFile(join(root, ".env"), env);
  await writeFile(join(root, "data/assets/user-image.bin"), "user image bytes");
  await writeFile(join(root, "my-personal-notes.txt"), "not a program file");
  await writeFile(join(root, "dist/obsolete-chunk.js"), "old program file");
  const fixture = spawnSync(node, ["--input-type=module", "-e", `
    import Database from 'better-sqlite3';
    const db = new Database('data/workspace.sqlite');
    db.exec('create table migration_fixture(value text)');
    db.prepare('insert into migration_fixture values (?)').run('saved conversation'); db.close();
  `], { cwd: root, encoding: "utf8" });
  assert.equal(fixture.status, 0, fixture.stderr);
  const dataHash = createHash("sha256").update(await readFile(join(root, "data/workspace.sqlite"))).digest("hex");
  const run = (target = root) => spawnSync(updater, ["--target", target, "--noninteractive"], { cwd: destination, encoding: "utf8", windowsHide: true, timeout: 90000 });
  const sameData = async () => {
    assert.equal(await readFile(join(root, ".env"), "utf8"), env);
    assert.equal(createHash("sha256").update(await readFile(join(root, "data/workspace.sqlite"))).digest("hex"), dataHash);
    assert.equal(await readFile(join(root, "data/assets/user-image.bin"), "utf8"), "user image bytes");
    assert.equal(await readFile(join(root, "my-personal-notes.txt"), "utf8"), "not a program file");
    await assert.rejects(access(join(root, "data/.update.lock")));
  };

  const wrongDirectory = run(destination);
  assert.notEqual(wrongDirectory.status, 0);
  await writeFile(manifestPath, JSON.stringify({ ...previous, version: "99.0.0" }));
  assert.notEqual(run().status, 0);
  await writeFile(manifestPath, JSON.stringify(previous));
  await rename(join(root, ".env"), join(root, ".env.saved"));
  const missingSecret = run();
  assert.notEqual(missingSecret.status, 0);
  await rename(join(root, ".env.saved"), join(root, ".env"));
  await writeFile(join(root, ".env"), env.replace("./data/assets", "./external-assets"));
  assert.notEqual(run().status, 0);
  await writeFile(join(root, ".env"), env.replace("12".repeat(32), "invalid-key"));
  assert.notEqual(run().status, 0);
  await writeFile(join(root, ".env"), env);
  await writeFile(join(root, "data/.update.lock"), "test-owned lock");
  const lockedStart = spawnSync(join(root, "图序.exe"), ["--noninteractive"], { cwd: destination, encoding: "utf8", windowsHide: true, timeout: 10000, stdio: ["pipe", "pipe", "pipe"] });
  assert.notEqual(lockedStart.status, 0);
  assert.match(lockedStart.stderr, /正在更新/);
  await unlink(join(root, "data/.update.lock"));

  const active = spawn(node, ["-e", "setInterval(() => {}, 1000)"], { cwd: root, windowsHide: true, stdio: "ignore" });
  await once(active, "spawn");
  try {
    const running = run();
    assert.notEqual(running.status, 0);
    assert.match(running.stderr, /仍在运行/);
    await assert.rejects(access(join(root, "data/backups")));
  } finally {
    active.kill();
    await once(active, "exit");
  }
  await sameData();

  await mkdir(legacyLicenses);
  await writeFile(join(legacyLicenses, "old-notice.txt"), "legacy component notice");
  // Lock a late program entry so earlier directory moves must be rolled back.
  const oldSnapshots = [];
  for (let index = 0; index < 3; index++) {
    const path = join(root, "data/backups", "update-20000101-000000-" + index.toString(16).padStart(8, "0"));
    await mkdir(join(path, "data"), { recursive: true });
    await mkdir(join(path, "program"));
    await writeFile(join(path, "update.json"), JSON.stringify({ state: "complete", version: next.version, buildId: previous.buildId, time: "200" + index + "-01-01T00:00:00Z" }));
    oldSnapshots.push(path);
  }
  const protectedSnapshot = join(root, "data/backups/update-20000101-000000-ffffffff");
  await mkdir(protectedSnapshot);
  await writeFile(join(protectedSnapshot, "update.json"), JSON.stringify({ state: "restore-required" }));
  const locker = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; $locked=[IO.File]::Open($env:TUXU_LOCK_FILE,'Open','Read','None'); [Console]::WriteLine('READY'); [Console]::ReadLine() | Out-Null; $locked.Dispose()"], {
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TUXU_LOCK_FILE: join(root, "使用说明.txt") },
  });
  try {
    let ready = "";
    const timeout = setTimeout(() => locker.kill(), 15000);
    while (!ready.includes("READY")) {
      const [chunk] = await once(locker.stdout, "data");
      ready += chunk;
    }
    clearTimeout(timeout);
    const failed = run();
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /已恢复原程序/);
    assert.match(failed.stderr, /使用说明.txt/);
    assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), previous);
    assert.equal(await readFile(join(root, "dist/obsolete-chunk.js"), "utf8"), "old program file");
    assert.equal(await readFile(join(legacyLicenses, "old-notice.txt"), "utf8"), "legacy component notice");
    for (const path of oldSnapshots) await access(path);
  } finally {
    locker.stdin.end("\n");
    await once(locker, "exit");
  }
  await sameData();

  const updated = run();
  assert.equal(updated.status, 0, updated.stderr + updated.stdout);
  assert.equal(JSON.parse(await readFile(manifestPath, "utf8")).buildId, next.buildId);
  await assert.rejects(access(join(root, "dist/obsolete-chunk.js")));
  await assert.rejects(access(legacyLicenses), { code: "ENOENT" });
  await sameData();
  const backups = await readdir(join(root, "data/backups"));
  assert.equal(backups.length, 4, "Two successful backups plus the protected failed and recovery snapshots");
  await assert.rejects(access(oldSnapshots[0]));
  await assert.rejects(access(oldSnapshots[1]));
  await access(oldSnapshots[2]);
  await access(protectedSnapshot);
  let complete;
  for (const folder of backups) {
    const path = join(root, "data/backups", folder);
    const state = JSON.parse(await readFile(join(path, "update.json"), "utf8"));
    if (state.state === "complete" && state.buildId === next.buildId) complete = path;
  }
  assert.ok(complete);
  assert.equal(await readFile(join(complete, ".env"), "utf8"), env);
  assert.equal(createHash("sha256").update(await readFile(join(complete, "data/workspace.sqlite"))).digest("hex"), dataHash);
  assert.equal(await readFile(join(complete, "program/dist/obsolete-chunk.js"), "utf8"), "old program file");
  assert.equal(await readFile(join(complete, "program/第三方许可/old-notice.txt"), "utf8"), "legacy component notice");
  await assert.rejects(access(join(complete, "data/backups")));
  const repeated = run();
  assert.notEqual(repeated.status, 0);
  assert.match(repeated.stderr, /无需重复更新/);
  await sameData();
  await writeFile(manifestPath, JSON.stringify(previous));
  const withoutLegacy = run();
  assert.equal(withoutLegacy.status, 0, withoutLegacy.stderr + withoutLegacy.stdout);
  await assert.rejects(access(legacyLicenses), { code: "ENOENT" });
  await sameData();
  await writeFile(artifactPath(`windows-update/${basename(destination)}/update-output.log`), updated.stdout);
});
