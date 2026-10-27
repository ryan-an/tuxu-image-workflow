import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import { networkInterfaces } from "node:os";
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
  const launcher = join(root, "图序.exe");
  const launcherBytes = await readFile(launcher);
  assert.equal(launcherBytes.subarray(0, 2).toString(), "MZ");
  assert.equal(launcherBytes.readUInt16LE(launcherBytes.readUInt32LE(0x3c) + 24 + 68), 2, "Launcher uses the Windows GUI subsystem");
  const icon = await readFile(join(root, "图序.ico"));
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt16LE(4), 7);
  const resource = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Drawing; $icon=[Drawing.Icon]::ExtractAssociatedIcon($env:TUXU_LAUNCHER); if ($null -eq $icon) { throw 'Missing executable icon' }; $icon.Dispose()"], { encoding: "utf8", windowsHide: true, env: { ...process.env, TUXU_LAUNCHER: launcher } });
  assert.equal(resource.status, 0, resource.stderr);
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
  const config = `HOST=0.0.0.0\nPORT=${port}\nNODE_ENV=production\nREQUIRE_HTTPS=false\nDATABASE_PATH=./data/workspace.sqlite\nASSET_DIRECTORY=./data/assets\nAPP_PASSWORD=portable-test-password\nCREDENTIAL_SECRET=${"34".repeat(32)}\n`;
  await writeFile(join(root, ".env"), config);
  let child;
  let logs = "";
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const finished = once(child, "exit");
    child.stdin.end("stop\n");
    const result = await Promise.race([finished, delay(15000, undefined, { ref: false }).then(() => { throw new Error("Graceful stop timed out"); })]);
    assert.equal(result[0], 0, logs);
    await delay(300);
  };
  const start = async () => {
    child = spawn(launcher, ["--noninteractive"], { cwd: destination, windowsHide: true, env: { ...process.env, NODE_PATH: "" }, stdio: ["pipe", "pipe", "pipe"] });
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
    const stateLine = logs.split(/\r?\n/).find((line) => line.startsWith("TUXU_DESKTOP:") && line.includes('"configuration"'));
    const connection = JSON.parse(stateLine.slice("TUXU_DESKTOP:".length));
    assert.equal(connection.origin, origin);
    for (const entry of Object.values(networkInterfaces()).flat().filter((item) => item.family === "IPv4" && !item.internal))
      assert.ok(connection.addresses.split("\n").includes(`http://${entry.address}:${port}`), "The desktop UI receives every LAN candidate address");
    await access(join(root, "第三方许可/AntdUI-Apache-2.0.txt"));
    assert.match(await (await fetch(origin)).text(), /href="\/tuxu.svg"/);
    const favicon = await fetch(`${origin}/tuxu.ico`);
    assert.equal(favicon.status, 200);
    assert.deepEqual(Buffer.from(await favicon.arrayBuffer()), icon);
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
    await stop();
    const trayHarness = join(destination, "tray-lifecycle.exe");
    const compilation = spawnSync(join(process.env.SystemRoot || "C:/Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe"), [
      "/nologo", "/target:exe", "/platform:x64", "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll",
      "/out:" + trayHarness, resolve("tests/support/windows-tray-lifecycle.cs"),
    ], { encoding: "utf8", windowsHide: true });
    assert.equal(compilation.status, 0, compilation.stdout + compilation.stderr);
    const graphical = spawnSync(trayHarness, [launcher, origin], { cwd: resolve("."), encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.equal(graphical.status, 0, graphical.stdout + graphical.stderr);
    assert.match(graphical.stdout, /GUI close keeps HTTP alive/);
    await assert.rejects(fetch(origin + "/health"));
    assert.equal(await readFile(join(root, ".env"), "utf8"), config);
  } finally {
    await stop();
    await writeFile(join(destination, "server.log"), logs);
  }
});
