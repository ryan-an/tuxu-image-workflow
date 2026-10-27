import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setupLocal, projectDirectory } from "./setup-local.mjs";
import { createInterface } from "node:readline";
const desktop = process.env.TUXU_DESKTOP === "1";
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
    stdio: [desktop ? "pipe" : "inherit", "pipe", "pipe", "ipc"],
    env: { ...process.env, ...configuration },
    windowsHide: true,
  },
);
let stopping = false;
let ready = false;
function stop() {
  if (stopping || child.exitCode !== null) return;
  stopping = true;
  if (!ready) return;
  if (child.connected) child.send({ type: "shutdown" });
  else child.kill("SIGTERM");
}
const input = desktop ? createInterface({ input: process.stdin }) : undefined;
input?.on("line", (line) => { if (line.trim() === "stop") stop(); });
input?.once("close", stop);
child.on("message", (message) => {
  if (message?.type !== "ready") return;
  ready = true;
  if (stopping) child.send({ type: "shutdown" });
  else if (desktop) console.log('TUXU_DESKTOP:{"type":"ready"}');
});
if (desktop) {
  process.stdout.on("error", stop);
  process.stderr.on("error", stop);
}
child.stdout.pipe(process.stdout, { end: false });
child.stderr.pipe(process.stderr, { end: false });
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
  input?.close();
  if (desktop) process.stdin.pause();
});
child.on("exit", (code) => {
  log.end();
  process.exitCode = code ?? 1;
  input?.close();
  if (desktop) process.stdin.pause();
});
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
