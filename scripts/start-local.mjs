import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setupLocal, projectDirectory } from "./setup-local.mjs";
const configuration = await setupLocal();
const logDirectory = join(projectDirectory, "data", "logs");
await mkdir(logDirectory, { recursive: true });
const logPath = join(logDirectory, "server.log");
const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
log.on("error", () =>
  console.error("日志文件写入失败，请检查 data/logs 目录权限和磁盘空间"),
);
console.log(`后台日志：${logPath}`);
const child = spawn(
  process.execPath,
  ["build-server/server/production/main.js", "all"],
  {
    cwd: projectDirectory,
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, ...configuration },
    windowsHide: true,
  },
);
child.stdout.pipe(process.stdout, { end: false });
child.stderr.pipe(process.stderr, { end: false });
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  log.end();
  process.exitCode = code ?? 1;
});
process.once("SIGINT", () => child.kill("SIGINT"));
process.once("SIGTERM", () => child.kill("SIGTERM"));
