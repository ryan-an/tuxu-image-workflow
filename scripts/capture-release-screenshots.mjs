import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { projectDirectory } from "./docker-common.mjs";

const result = spawnSync(
  process.execPath,
  [
    process.env.npm_execpath,
    "run",
    "test:e2e",
    "--",
    "release-screenshots-browser",
  ],
  { cwd: projectDirectory, stdio: "inherit", env: process.env },
);
if (result.status !== 0) process.exit(result.status || 1);
const { version } = JSON.parse(
  await readFile(join(projectDirectory, "package.json"), "utf8"),
);
const output = join(projectDirectory, "docs/releases", `v${version}`);
await mkdir(output, { recursive: true });
for (const name of [
  "workspaces",
  "members",
  "collaboration",
  "history",
  "previews",
])
  await sharp(
    join(
      projectDirectory,
      "artifacts/tests/release-screenshots",
      `${name}.png`,
    ),
  )
    .resize({ width: 1440, withoutEnlargement: true })
    .webp({ quality: 88 })
    .toFile(join(output, `${name}.webp`));
console.log(`已保存 v${version} 的 5 张实际界面截图：${output}`);
