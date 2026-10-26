import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
const { artifactPath } = createRequire(import.meta.url)(resolve("tests/support/artifacts.cjs"));

test("Windows portable ZIP boots using only its own runtime and preserves login after restart", {
  skip: !process.env.TUXU_WINDOWS_BUNDLE,
  timeout: 90000,
}, async () => {
  const destination = artifactPath(`windows-portable/${randomUUID()}`);
  await mkdir(destination, { recursive: true });
  const archive = resolve(process.env.TUXU_WINDOWS_BUNDLE);
  const extraction = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:TUXU_PACKAGE_ARCHIVE, $env:TUXU_PACKAGE_DESTINATION)"], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, TUXU_PACKAGE_ARCHIVE: archive, TUXU_PACKAGE_DESTINATION: destination },
  });
  assert.equal(extraction.status, 0, extraction.stderr);
  const root = join(destination, archive.split(/[\\/]/).at(-1).replace(/\.zip$/, ""));
  await assert.rejects(access(join(root, ".env")));
  await assert.rejects(access(join(root, "data")));
  const executable = join(root, "runtime/node.exe");
  const probe = spawnSync(executable, ["--input-type=module", "-e", `
    import Database from 'better-sqlite3'; import sharp from 'sharp'; import ExcelJS from 'exceljs';
    const db = new Database(':memory:');
    if (db.prepare('select 1 as ok').get().ok !== 1) throw new Error('sqlite');
    db.close(); await sharp({create:{width:1,height:1,channels:4,background:'#fff'}}).png().toBuffer();
    const workbook = new ExcelJS.Workbook(); workbook.addWorksheet('test'); await workbook.xlsx.writeBuffer();
  `], { cwd: root, encoding: "utf8", env: { ...process.env, NODE_PATH: "" } });
  assert.equal(probe.status, 0, probe.stderr);
  const socket = createServer();
  await new Promise((done) => socket.listen(0, "127.0.0.1", done));
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  const config = `HOST=127.0.0.1\nPORT=${port}\nNODE_ENV=production\nREQUIRE_HTTPS=false\nDATABASE_PATH=./data/workspace.sqlite\nASSET_DIRECTORY=./data/assets\nAPP_PASSWORD=portable-test-password\nCREDENTIAL_SECRET=${"34".repeat(32)}\n`;
  await writeFile(join(root, ".env"), config);
  let child;
  let logs = "";
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    // Kill the test-owned launcher and its server together on Windows.
    const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    await delay(300);
  };
  const start = async () => {
    child = spawn(executable, ["scripts/windows-start.mjs"], { cwd: root, windowsHide: true, env: { ...process.env, NODE_PATH: "" }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { logs += chunk; });
    child.stderr.on("data", (chunk) => { logs += chunk; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(logs);
      try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {}
      await delay(100);
    }
    throw new Error(`Portable server startup timed out: ${logs}`);
  };
  try {
    await start();
    const origin = `http://127.0.0.1:${port}`;
    assert.match(await (await fetch(origin)).text(), /<html/);
    const login = await fetch(`${origin}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ username: "admin", password: "portable-test-password" }),
    });
    assert.equal(login.status, 200, await login.text());
    const cookie = login.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(`${origin}/api/workspace`, { headers: { cookie } })).status, 200);
    await stop();
    await start();
    assert.equal((await fetch(`${origin}/api/workspace`, { headers: { cookie } })).status, 200);
    assert.equal(await readFile(join(root, ".env"), "utf8"), config);
    await access(join(root, "data/workspace.sqlite"));
    assert.ok(!logs.includes("portable-test-password"));
  } finally {
    await stop();
    await writeFile(join(destination, "server.log"), logs);
  }
});
