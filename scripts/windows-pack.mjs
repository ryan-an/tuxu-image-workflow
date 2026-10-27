import { cp, mkdir, readFile, writeFile, copyFile, access, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, dirname, basename, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { prepareDesktopUi } from "./windows-ui-dependencies.mjs";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: { "update-only": { type: "boolean", default: false }, output: { type: "string" } } });
const updateOnly = values["update-only"];
if (process.platform !== "win32" || process.arch !== "x64" || Number(process.versions.node.split(".")[0]) !== 24)
  throw new Error("请使用 Windows x64 Node.js 24 打包，以保证原生依赖兼容。");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const output = resolve(root, values.output || "artifacts/windows");
await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(output, ".pack-"));
const name = `tuxu-windows-x64-v${pkg.version}`;
const buildId = new Date().toISOString().replace(/[-:.]/g, "");
const bundle = join(staging, name);
await mkdir(join(bundle, "runtime"), { recursive: true });
const icons = spawnSync(process.execPath, [join(root, "scripts/build-app-icon.mjs")], { cwd: root, stdio: "inherit", windowsHide: true });
if (icons.error) throw icons.error;
if (icons.status !== 0) throw new Error("Windows 图标生成失败");
const compiler = join(process.env.SystemRoot || "C:/Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
const ui = await prepareDesktopUi(root, staging);
const desktopArgs = [`/reference:${ui.assembly}`, `/resource:${ui.assembly},tuxu.desktop.antd`, `/resource:${join(root, "public/tuxu.svg")},tuxu.desktop.logo`, `/resource:${join(root, "scripts/windows/licenses/AntdUI-Apache-2.0.txt")},tuxu.desktop.license`, `/win32manifest:${join(root, "scripts/windows/Desktop.manifest")}`, join(root, "scripts/windows/DesktopBootstrap.cs"), join(root, "scripts/windows/DesktopUi.cs"), ui.theme];
const launcher = spawnSync(compiler, ["/nologo", "/target:winexe", "/platform:x64", "/optimize+", "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll", "/reference:System.Web.Extensions.dll", `/win32icon:${join(root, "public/tuxu.ico")}`, `/out:${join(bundle, "图序.exe")}`, ...desktopArgs, join(root, "scripts/windows/Launcher.cs"), join(root, "scripts/windows/DesktopService.cs")], { cwd: root, stdio: "inherit", windowsHide: true });
if (launcher.error) throw launcher.error;
if (launcher.status !== 0) throw new Error("Windows 启动入口编译失败");
await copyFile(join(root, "public/tuxu.ico"), join(bundle, "图序.ico"));
await mkdir(join(bundle, "runtime/licenses"), { recursive: true });
await copyFile(join(root, "scripts/windows/licenses/AntdUI-Apache-2.0.txt"), join(bundle, "runtime/licenses/AntdUI-Apache-2.0.txt"));
const desktopNotice = "AntdUI 2.4.16\nCopyright © Tom 2024-2030\nhttps://github.com/AntdUI/AntdUI\nLicensed under Apache-2.0. Unmodified assembly embedded in launcher and updater.\nSee AntdUI-Apache-2.0.txt for the full license.\n";
await writeFile(join(bundle, "runtime/licenses/NOTICE.txt"), "以下声明仅适用于所列第三方组件，不授予图序自有代码的开源许可。\n\n" + desktopNotice);
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
await copyFile(join(root, "docs/data-migration.md"), join(bundle, "数据迁移说明.md"));
const updateGuide = await readFile(join(root, "docs/windows-update.md"), "utf8");
let versionNotes = "";
try {
  versionNotes = await readFile(join(root, `docs/releases/v${pkg.version}.md`), "utf8");
} catch (error) { if (error.code !== "ENOENT") throw error; }
versionNotes = versionNotes.replaceAll("../data-migration.md", "数据迁移说明.md").replaceAll("../windows-update.md", "更新说明.md");
await writeFile(join(bundle, "更新说明.md"), versionNotes ? `${versionNotes}\n\n---\n\n${updateGuide}` : updateGuide);
await writeFile(join(bundle, "manifest.json"), JSON.stringify({ version: pkg.version, buildId, platform: "win32-x64", node: process.version, dependencyCount: selected.size }, null, 2));
const archive = join(output, `${name}.zip`);
const temporaryArchive = join(staging, `${name}.zip`);
const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:TUXU_PACKAGE_SOURCE, $env:TUXU_PACKAGE_ARCHIVE, [IO.Compression.CompressionLevel]::Optimal, $true)"], {
  stdio: "inherit", windowsHide: true,
  env: { ...process.env, TUXU_PACKAGE_SOURCE: bundle, TUXU_PACKAGE_ARCHIVE: temporaryArchive },
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`ZIP 打包失败（退出码 ${result.status}）`);
const digest = createHash("sha256").update(await readFile(temporaryArchive)).digest("hex");
if (!updateOnly) {
  await copyFile(temporaryArchive, archive);
  await writeFile(`${archive}.sha256`, `${digest}  ${name}.zip\n`);
}
const updateInfo = join(staging, "update-info.json");
await writeFile(updateInfo, JSON.stringify({ version: pkg.version, buildId, archiveRoot: name, sha256: digest }));
const updaterName = `tuxu-update-windows-x64-v${pkg.version}.exe`;
const updaterFile = join(staging, updaterName);
const updater = spawnSync(compiler, ["/nologo", "/target:winexe", "/platform:x64", "/optimize+", "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll", "/reference:System.Web.Extensions.dll", "/reference:System.IO.Compression.dll", `/win32icon:${join(root, "public/tuxu.ico")}`, `/resource:${temporaryArchive},tuxu.update.payload`, `/resource:${updateInfo},tuxu.update.info`, `/out:${updaterFile}`, ...desktopArgs, join(root, "scripts/windows/Updater.cs"), join(root, "scripts/windows/BackupRetention.cs")], { cwd: root, stdio: "inherit", windowsHide: true });
if (updater.error) throw updater.error;
if (updater.status !== 0) throw new Error("Windows 离线更新工具编译失败");
await copyFile(updaterFile, join(output, updaterName));
const updaterDigest = createHash("sha256").update(await readFile(updaterFile)).digest("hex");
await writeFile(join(output, `${updaterName}.sha256`), `${updaterDigest}  ${updaterName}\n`);
if (dirname(resolve(staging)) !== resolve(output) || !basename(staging).startsWith(".pack-"))
  throw new Error("拒绝清理打包目录之外的路径");
await rm(staging, { recursive: true, force: true });
if (!updateOnly) console.log(`已生成：${archive}\nSHA256：${digest}`);
console.log(`运行依赖：${selected.size} 个；Node.js ${process.version}${updateOnly ? "；仅输出更新 EXE 与校验文件" : ""}`);
console.log(`离线更新工具：${join(output, updaterName)}\n构建标识：${buildId}`);
