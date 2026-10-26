import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
export const defaultBundle = resolve(projectDirectory, "artifacts/docker/tuxu");

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectDirectory,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error) {
    if (result.error.code === "ENOENT")
      throw new Error(`找不到 ${command}，请先安装并加入 PATH。`);
    throw result.error;
  }
  if (result.status !== 0)
    throw new Error(`${command} 执行失败（退出码 ${result.status}）。`);
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function main(action) {
  action().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
