import { readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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
if (!files.length) throw new Error(`测试分组为空：${group}`);
const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
