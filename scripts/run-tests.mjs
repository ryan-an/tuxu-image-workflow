import { readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const groups = {
  all: ["unit", "integration"],
  unit: ["unit"],
  integration: ["integration"],
  production: ["unit/server", "integration/server"],
  e2e: ["e2e"],
};
const group = process.argv[2] || "all";
if (!Object.hasOwn(groups, group)) {
  throw new Error(`未知测试分组：${group}`);
}
if (group === "e2e" && !process.env.PLAYWRIGHT_MODULE) {
  throw new Error(
    "浏览器回归需要设置 PLAYWRIGHT_MODULE，可选设置 CHROME_PATH。详见 tests/README.md。",
  );
}

// Discover from source so stale build output cannot run removed or moved tests.
const files = [];
for (const directory of groups[group]) {
  const source = resolve(root, "tests", directory);
  for (const entry of await readdir(source, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !/\.test\.(?:js|ts)$/.test(entry.name)) continue;
    const file = relative(root, resolve(entry.parentPath, entry.name));
    files.push(resolve(root, "build-test", file.replace(/\.ts$/, ".js")));
  }
}
files.sort();
const filters = process.argv.slice(3);
const selectedFiles = filters.length
  ? files.filter((file) =>
      filters.some((filter) =>
        relative(root, file)
          .replaceAll("\\", "/")
          .includes(filter.replaceAll("\\", "/")),
      ),
    )
  : files;
if (!selectedFiles.length)
  throw new Error(`没有匹配的测试：${filters.join(", ")}`);
if (!files.length) throw new Error(`测试分组为空：${group}`);
// A browser file starts its own Chrome. Never multiply those by the CPU count.
const concurrency = group === "e2e" ? 1 : 2;
console.log(
  `测试文件 ${selectedFiles.length} 个，并发 ${concurrency}${filters.length ? `，筛选：${filters.join(", ")}` : ""}`,
);
// Different chats/terminals must not launch overlapping browser suites either.
const lockPath = resolve(
  tmpdir(),
  `tuxu-e2e-${createHash("sha256").update(root).digest("hex").slice(0, 16)}.lock`,
);
let ownsLock = false;
if (group === "e2e") {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeFileSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      ownsLock = true;
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = Number(readFileSync(lockPath, "utf8"));
      if (!Number.isSafeInteger(owner) || owner <= 0)
        throw new Error("浏览器测试锁正在初始化，请稍后重试");
      let running = true;
      try {
        process.kill(owner, 0);
      } catch (error) {
        if (error.code === "ESRCH") running = false;
        else throw error;
      }
      if (running)
        throw new Error(
          `当前项目已有浏览器回归正在运行（PID ${owner}），请等待结束，避免电脑卡顿`,
        );
      if (readFileSync(lockPath, "utf8") === String(owner))
        unlinkSync(lockPath);
    }
  }
  if (!ownsLock) throw new Error("其他进程正在启动浏览器回归，请稍后重试");
}
try {
  const result = spawnSync(
    process.execPath,
    ["--test", `--test-concurrency=${concurrency}`, ...selectedFiles],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (ownsLock && readFileSync(lockPath, "utf8") === String(process.pid))
    unlinkSync(lockPath);
}
