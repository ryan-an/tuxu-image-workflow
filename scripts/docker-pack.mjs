import {
  mkdir,
  readFile,
  copyFile,
  writeFile,
  rename,
  cp,
  mkdtemp,
  access,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import {
  run,
  main,
  projectDirectory,
  defaultBundle,
} from "./docker-common.mjs";
import {
  prepareDeploymentRelease,
  withReleaseLock,
} from "./release-manager.mjs";
import { buildReleaseNotes } from "./build-release-notes.mjs";

main(async () => {
  const { values } = parseArgs({
    options: {
      platform: { type: "string", default: "linux/amd64" },
      tag: { type: "string" },
      out: { type: "string", default: defaultBundle },
      image: { type: "boolean", default: false },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "npm run docker:pack -- [--platform linux/amd64|linux/arm64] [--tag 镜像名:标签] [--out 目录] [--image 完整镜像模式，需要本机Docker]\n首次使用待打包版本，后续新包自动递增修订号；保留版本包与图文更新日志。",
    );
    return;
  }
  if (!["linux/amd64", "linux/arm64"].includes(values.platform))
    throw new Error("platform 仅支持 linux/amd64 或 linux/arm64。");
  if (
    values.tag &&
    !/^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(values.tag)
  )
    throw new Error("镜像名需要包含标签，例如 tuxu-image:0.2.0。");
  await withReleaseLock(projectDirectory, async () => {
    const release = await prepareDeploymentRelease();
    try {
      await buildReleaseNotes();
      const image = values.tag || `tuxu-image:${release.version}`;
      const output = resolve(values.out);
      const historyRoot = join(projectDirectory, "artifacts/docker/releases");
      const history = join(historyRoot, `v${release.version}`);
      await mkdir(historyRoot, { recursive: true });
      let occupied = false;
      try {
        await access(history);
        occupied = true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (occupied)
        throw new Error(
          `版本包 v${release.version} 已存在，请使用 release 命令准备新版本；已有包可直接重复部署。`,
        );
      const staging = await mkdtemp(
        join(historyRoot, `.pack-${release.version}-`),
      );
      const archive = values.image ? "tuxu-image.tar" : "tuxu-app.tar.gz";
      if (values.image) {
        run("docker", ["info"]);
        console.log(`构建 ${image}（${values.platform}）……`);
        run("docker", [
          "build",
          "--platform",
          values.platform,
          "--tag",
          image,
          ".",
        ]);
        run("docker", ["save", "--output", join(staging, archive), image]);
      } else {
        const npmCli = process.env.npm_execpath;
        if (!npmCli)
          throw new Error("请通过 npm run docker:pack 执行编译产物打包。");
        console.log(`编译 v${release.version}，并生成静态更新日志……`);
        run(process.execPath, [npmCli, "run", "build"]);
        run("tar", [
          "-czf",
          join(staging, archive),
          "--exclude=*.map",
          "-C",
          projectDirectory,
          "dist",
          "build-server",
          "package.json",
          "package-lock.json",
          "Dockerfile.runtime",
        ]);
      }
      await copyFile(
        join(projectDirectory, "scripts/docker-configure.mjs"),
        join(staging, "configure.mjs"),
      );
      // Also include a standalone folder that can be uploaded to any static host.
      await cp(
        join(projectDirectory, "public/updates"),
        join(staging, "updates"),
        { recursive: true },
      );
      const manifest = {
        version: release.version,
        date: release.date,
        image,
        platform: values.platform,
        kind: values.image ? "image" : "runtime",
        archive,
        releaseNotes: `/updates/v${release.version}.html`,
        sha256: createHash("sha256")
          .update(await readFile(join(staging, archive)))
          .digest("hex"),
      };
      await writeFile(
        join(staging, "manifest.json"),
        JSON.stringify(manifest, null, 2) + "\n",
      );
      await rename(staging, history);
      await mkdir(output, { recursive: true });
      for (const name of [archive, "configure.mjs"])
        await copyFile(join(history, name), join(output, name));
      await cp(join(history, "updates"), join(output, "updates"), {
        recursive: true,
      });
      // Publish metadata last, after all package files are available.
      await copyFile(
        join(history, "manifest.json"),
        join(output, "manifest.json"),
      );
      await release.commit();
      console.log(
        `\nv${release.version} 部署包：${output}\n历史版本：${history}\n独立图文日志：${join(history, "updates/index.html")}\n部署：npm run docker:deploy -- --host root@服务器IP [--domain 你的域名]\n重复部署同一包不会递增版本；新包自动生成下一个修订号。`,
      );
    } catch (error) {
      await release.rollback();
      await buildReleaseNotes();
      throw error;
    }
  });
});
