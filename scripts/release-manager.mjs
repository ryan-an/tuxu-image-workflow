import { readFile, writeFile, mkdir, open, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { projectDirectory } from "./docker-common.mjs";
import { buildReleaseNotes } from "./build-release-notes.mjs";

export function nextVersion(version, kind = "patch") {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("版本号须为三段数字，例如 0.2.0");
  const [major, minor, patch] = version.split(".").map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind !== "patch") throw new Error("版本递增方式为 patch、minor 或 major");
  return `${major}.${minor}.${patch + 1}`;
}
const beijingDate = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
    new Date(),
  );
const filenames = [
  "package.json",
  "package-lock.json",
  "docs/releases/releases.json",
];

async function readState(root) {
  const original = await Promise.all(
    filenames.map((name) => readFile(join(root, name), "utf8")),
  );
  const [pkg, lock, notes] = original.map((text) => JSON.parse(text));
  if (pkg.version !== notes.releases[0]?.version)
    throw new Error("应用版本与更新日志版本不一致");
  nextVersion(pkg.version);
  return { original, pkg, lock, notes };
}
async function save(root, state) {
  state.lock.version = state.pkg.version;
  state.lock.packages[""].version = state.pkg.version;
  for (const [index, value] of [state.pkg, state.lock, state.notes].entries())
    await writeFile(
      join(root, filenames[index]),
      JSON.stringify(value, null, 2) + "\n",
    );
}
function appendRelease(state, kind, title, note) {
  const previous = state.notes.releases[0];
  const version = nextVersion(state.pkg.version, kind);
  const release = {
    version,
    date: beijingDate(),
    title: title || "工作台版本更新",
    summary:
      note ||
      `工作台已更新至 v${version}，以下保留当前提供的主要功能与使用方法。`,
    notesVersion: previous.features ? previous.version : previous.notesVersion,
    ...(note ? { note } : {}),
  };
  state.notes.releases.unshift(release);
  state.pkg.version = version;
  return release;
}

// Preparing a package reserves the next version. A failed build restores all
// source metadata; retrying deployment of an existing bundle never calls this.
export async function prepareDeploymentRelease(root = projectDirectory) {
  const state = await readState(root);
  const previousVersion = state.pkg.version;
  const release = state.notes.releases[0].packagedAt
    ? appendRelease(state, "patch")
    : state.notes.releases[0];
  await save(root, state);
  return {
    version: release.version,
    date: release.date,
    async commit() {
      release.packagedAt = new Date().toISOString();
      await save(root, state);
    },
    async rollback() {
      for (const [index, text] of state.original.entries())
        await writeFile(join(root, filenames[index]), text);
      if (previousVersion !== release.version)
        await unlink(
          join(root, "public/updates", `v${release.version}.html`),
        ).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
    },
  };
}

export async function withReleaseLock(root, action) {
  const directory = join(root, "artifacts/docker");
  await mkdir(directory, { recursive: true });
  const filename = join(directory, "release-pack.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    let file;
    try {
      file = await open(filename, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = Number(await readFile(filename, "utf8"));
      if (!Number.isSafeInteger(owner) || owner <= 0)
        throw new Error("部署包版本锁正在初始化，请稍后重试");
      try {
        process.kill(owner, 0);
      } catch (error) {
        if (error.code === "ESRCH") {
          await unlink(filename);
          continue;
        }
        throw error;
      }
      throw new Error("当前项目已有部署包正在生成，请等待完成后再打包");
    }
    try {
      await file.writeFile(String(process.pid));
      await file.close();
      return await action();
    } finally {
      await file.close();
      await unlink(filename);
    }
  }
  throw new Error("无法获取部署包版本锁，请稍后重试");
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      title: { type: "string" },
      note: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help)
    console.log(
      'npm run release -- patch|minor|major [--title "更新主题"] [--note "面向用户的更新内容"]',
    );
  else
    withReleaseLock(projectDirectory, async () => {
      const state = await readState(projectDirectory);
      appendRelease(
        state,
        positionals[0] || "patch",
        values.title,
        values.note,
      );
      await save(projectDirectory, state);
      await buildReleaseNotes();
      console.log(
        `已准备 v${state.pkg.version}，下次 docker:pack 将使用这个版本。`,
      );
    }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
