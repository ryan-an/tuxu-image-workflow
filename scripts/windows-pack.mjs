import { cp, mkdir, readFile, writeFile, copyFile, access, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, dirname, basename, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
if (process.platform !== "win32" || process.arch !== "x64" || Number(process.versions.node.split(".")[0]) !== 24)
  throw new Error("请使用 Windows x64 Node.js 24 打包，以保证原生依赖兼容。");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const output = join(root, "artifacts/windows");
await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(output, ".pack-"));
const name = `tuxu-windows-x64-v${pkg.version}`;
const bundle = join(staging, name);
await mkdir(join(bundle, "runtime"), { recursive: true });
// The serving dist directory deliberately retains old chunks for open browser tabs.
// Build a fresh package frontend so historical chunks do not inflate the ZIP.
const frontend = spawnSync(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build", "--outDir", join(bundle, "dist"), "--emptyOutDir"], { cwd: root, stdio: "inherit", windowsHide: true });
if (frontend.error) throw frontend.error;
if (frontend.status !== 0) throw new Error("便携包前端构建失败");
await cp(join(root, "build-server"), join(bundle, "build-server"), { recursive: true, filter: (path) => !path.endsWith(".map") });
await copyFile(process.execPath, join(bundle, "runtime/node.exe"));
let license;
for (const path of [join(dirname(process.execPath), "LICENSE"), join(output, `node-${process.version}-LICENSE.txt`)]) {
  try { license = await readFile(path, "utf8"); break; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
if (!license) {
  const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
  if (!response.ok) throw new Error("无法取得对应版本的 Node.js 官方许可证");
  license = await response.text();
}
if (!license.includes("Node.js") || !license.includes("Permission")) throw new Error("Node.js 许可证内容无效");
await writeFile(join(bundle, "runtime/LICENSE.txt"), license);

// Preserve npm's installed layout, including nested versions and native optional packages.
const selected = new Set();
async function collect(name, parent = "") {
  let location = parent;
  let key;
  while (true) {
    const candidate = posix.join(location, "node_modules", name);
    if (lock.packages[candidate]) { key = candidate; break; }
    if (!location) break;
    location = posix.dirname(location);
    if (location === ".") location = "";
  }
  if (!key) throw new Error(`锁文件缺少运行依赖 ${name}`);
  await access(join(root, key));
  if (selected.has(key)) return;
  selected.add(key);
  const entry = lock.packages[key];
  for (const dep of Object.keys(entry.dependencies || {})) {
    if (!Object.hasOwn(entry.optionalDependencies || {}, dep)) await collect(dep, key);
  }
  for (const dep of Object.keys(entry.optionalDependencies || {})) {
    // Packages for other operating systems are intentionally absent.
    try { await collect(dep, key); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
for (const dep of ["fastify", "@fastify/static", "@fastify/compress", "better-sqlite3", "sharp", "exceljs", "jszip"])
  await collect(dep);
for (const key of selected) {
  await mkdir(dirname(join(bundle, key)), { recursive: true });
  await cp(join(root, key), join(bundle, key), {
    recursive: true,
    filter: (path) => path === join(root, key) || !path.slice(join(root, key).length + 1).split(/[\\/]/).includes("node_modules"),
  });
}
await writeFile(join(bundle, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: "module" }, null, 2));
await mkdir(join(bundle, "scripts"), { recursive: true });
for (const file of ["start-local.mjs", "setup-local.mjs", "windows-start.mjs"])
  await copyFile(join(root, "scripts", file), join(bundle, "scripts", file));
await writeFile(join(bundle, "启动图序.cmd"), '@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\n"%~dp0runtime\\node.exe" "%~dp0scripts\\windows-start.mjs"\r\npause\r\n');
await writeFile(join(bundle, "放行局域网.cmd"), '@echo off\r\nchcp 65001 >nul\r\npowershell.exe -NoProfile -Command "if (-not (Get-NetFirewallRule -DisplayName \'图序局域网访问\' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName \'图序局域网访问\' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001 -Profile Private -RemoteAddress LocalSubnet }"\r\necho 请确保办公网络已设为专用网络；失败时请右键以管理员身份运行。\r\npause\r\n');
await copyFile(join(root, "docs/windows-portable.md"), join(bundle, "使用说明.txt"));
await writeFile(join(bundle, "manifest.json"), JSON.stringify({ version: pkg.version, platform: "win32-x64", node: process.version, dependencyCount: selected.size }, null, 2));
const archive = join(output, `${name}.zip`);
const temporaryArchive = join(staging, `${name}.zip`);
const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:TUXU_PACKAGE_SOURCE, $env:TUXU_PACKAGE_ARCHIVE, [IO.Compression.CompressionLevel]::Optimal, $true)"], {
  stdio: "inherit", windowsHide: true,
  env: { ...process.env, TUXU_PACKAGE_SOURCE: bundle, TUXU_PACKAGE_ARCHIVE: temporaryArchive },
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`ZIP 打包失败（退出码 ${result.status}）`);
await copyFile(temporaryArchive, archive);
const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
await writeFile(`${archive}.sha256`, `${digest}  ${name}.zip\n`);
if (dirname(resolve(staging)) !== resolve(output) || !basename(staging).startsWith(".pack-"))
  throw new Error("拒绝清理打包目录之外的路径");
await rm(staging, { recursive: true, force: true });
console.log(`已生成：${archive}\n运行依赖：${selected.size} 个；Node.js ${process.version}\nSHA256：${digest}`);
