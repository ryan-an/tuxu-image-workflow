import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { prepareDesktopUi } from "../../scripts/windows-ui-dependencies.mjs";

const { artifactPath } = createRequire(import.meta.url)(resolve("tests/support/artifacts.cjs"));
const out = artifactPath("windows-ui-preview");
await mkdir(out, { recursive: true });
const compilation = join(out, "build");
await mkdir(compilation, { recursive: true });
const ui = await prepareDesktopUi(process.cwd(), compilation);
const compiler = join(process.env.SystemRoot || "C:/Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
const run = (executable, args) => {
  const result = spawnSync(executable, args, { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`UI preview failed: ${result.status}`);
};
const common = ["/nologo", "/target:winexe", "/platform:x64", "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll", "/reference:System.Web.Extensions.dll", "/reference:System.IO.Compression.dll", `/reference:${ui.assembly}`, `/resource:${ui.assembly},tuxu.desktop.antd`, `/resource:${resolve("public/tuxu.svg")},tuxu.desktop.logo`, `/win32icon:${resolve("public/tuxu.ico")}`];
const shared = [resolve("scripts/windows/DesktopBootstrap.cs"), resolve("scripts/windows/DesktopUi.cs"), ui.theme];
const launcher = join(out, "launcher.exe");
const updater = join(out, "updater.exe");
run(compiler, [...common, `/out:${launcher}`, ...shared, resolve("scripts/windows/Launcher.cs"), resolve("scripts/windows/DesktopService.cs")]);
run(compiler, [...common, `/out:${updater}`, ...shared, resolve("scripts/windows/Updater.cs"), resolve("scripts/windows/BackupRetention.cs")]);
const preview = join(out, "preview.exe");
run(compiler, ["/nologo", "/target:winexe", "/platform:x64", "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll", `/win32manifest:${resolve("scripts/windows/Desktop.manifest")}`, `/out:${preview}`, resolve("tests/support/preview-windows-ui.cs")]);
run(preview, [launcher, updater, out]);
console.log(out);
