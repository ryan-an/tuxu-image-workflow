import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const { artifactPath } = createRequire(import.meta.url)(
  resolve("tests/support/artifacts.cjs"),
);
const { nextVersion, prepareDeploymentRelease, withReleaseLock } = await import(
  pathToFileURL(resolve("scripts/release-manager.mjs")).href
);
const { buildReleaseNotes } = await import(
  pathToFileURL(resolve("scripts/build-release-notes.mjs")).href
);
async function fixture() {
  const root = artifactPath(`releases/${randomUUID()}`);
  await mkdir(join(root, "docs/releases/v0.2.0"), { recursive: true });
  const pkg = { name: "release-fixture", version: "0.2.0" };
  await writeFile(join(root, "package.json"), JSON.stringify(pkg));
  await writeFile(
    join(root, "package-lock.json"),
    JSON.stringify({ version: pkg.version, packages: { "": pkg } }),
  );
  await writeFile(
    join(root, "docs/releases/releases.json"),
    JSON.stringify({
      releases: [
        {
          version: pkg.version,
          date: "2026-10-26",
          title: '<script>alert("unsafe")</script>',
          summary: "一起协作",
          highlights: ["工作区"],
          features: [
            {
              id: "workspaces",
              title: "项目管理",
              intro: "资料分开",
              steps: ["打开工作区"],
              image: "workspaces.webp",
              alt: "实际界面",
              caption: "演示资料",
            },
          ],
          fixes: ["修复显示问题"],
          tips: ["按权限使用"],
        },
      ],
    }),
  );
  await writeFile(
    join(root, "docs/releases/page.css"),
    "body { color: black; }",
  );
  await writeFile(
    join(root, "docs/releases/v0.2.0/workspaces.webp"),
    "fixture-image",
  );
  return root;
}

test("package versions advance only after a successful package and failed builds restore exact metadata", async () => {
  const root = await fixture();
  const original = await readFile(join(root, "package.json"), "utf8");
  const failed = await prepareDeploymentRelease(root);
  assert.equal(failed.version, "0.2.0");
  await failed.rollback();
  assert.equal(await readFile(join(root, "package.json"), "utf8"), original);
  const first = await prepareDeploymentRelease(root);
  await first.commit();
  const next = await prepareDeploymentRelease(root);
  assert.equal(next.version, "0.2.1");
  await buildReleaseNotes(root);
  assert.equal(
    JSON.parse(await readFile(join(root, "public/version.json"))).version,
    "0.2.1",
  );
  const page = await readFile(join(root, "public/updates/v0.2.1.html"), "utf8");
  assert.match(page, /v0.2.0 起提供/);
  assert.doesNotMatch(page, /<script>/);
  await next.rollback();
  await assert.rejects(access(join(root, "public/updates/v0.2.1.html")), {
    code: "ENOENT",
  });
  assert.equal(
    JSON.parse(await readFile(join(root, "package.json"))).version,
    "0.2.0",
  );
  const retry = await prepareDeploymentRelease(root);
  assert.equal(retry.version, "0.2.1");
  await retry.commit();
  const third = await prepareDeploymentRelease(root);
  assert.equal(third.version, "0.2.2");
  await third.rollback();
  const lock = JSON.parse(await readFile(join(root, "package-lock.json")));
  assert.equal(lock.version, "0.2.1");
  assert.equal(lock.packages[""].version, "0.2.1");
});

test("release documents include escaped customer text, local images and a matching version manifest", async () => {
  const root = await fixture();
  await buildReleaseNotes(root);
  const html = await readFile(join(root, "public/updates/index.html"), "utf8");
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /images\/v0.2.0\/workspaces.webp/);
  assert.equal(
    await readFile(
      join(root, "public/updates/images/v0.2.0/workspaces.webp"),
      "utf8",
    ),
    "fixture-image",
  );
  assert.equal(
    html,
    await readFile(join(root, "public/updates/v0.2.0.html"), "utf8"),
  );
  assert.equal(nextVersion("0.2.9"), "0.2.10");
  assert.equal(nextVersion("0.2.9", "minor"), "0.3.0");
  assert.equal(nextVersion("0.2.9", "major"), "1.0.0");
  assert.throws(() => nextVersion("latest"), /三段数字/);
});

test("parallel packaging is rejected and action failures never retain the version lock", async () => {
  const root = await fixture();
  await withReleaseLock(root, async () => {
    await assert.rejects(
      withReleaseLock(root, async () => {}),
      /已有部署包正在生成/,
    );
  });
  const failure = Object.assign(new Error("archive already exists"), {
    code: "EEXIST",
  });
  await assert.rejects(
    withReleaseLock(root, async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  await withReleaseLock(root, async () => {});
  await assert.rejects(
    access(join(root, "artifacts/docker/release-pack.lock")),
    { code: "ENOENT" },
  );
});
