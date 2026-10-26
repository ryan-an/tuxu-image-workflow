import { spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryRoot = resolve(tmpdir());
const staging = await mkdtemp(join(temporaryRoot, "tuxu-deploy-"));
const application = join(staging, "build-mirror");
const archive = resolve(root, "..", "tuxu-app.tar.gz");

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`打包失败：${command}（退出码 ${result.status}）`);
}

function nodeTool(path, args) {
  run(process.execPath, [join(root, path), ...args]);
}

try {
  console.log(
    "在本机编译前后端；服务器部署包不包含项目源码。请先安装项目依赖。",
  );
  await mkdir(application);
  nodeTool("node_modules/typescript/bin/tsc", ["--noEmit"]);
  nodeTool("node_modules/typescript/bin/tsc", ["-p", "tsconfig.frontend.json"]);
  // Build into a fresh directory so old local dist chunks never enter the bundle.
  nodeTool("node_modules/vite/bin/vite.js", [
    "build",
    "--outDir",
    join(application, "dist"),
    "--emptyOutDir",
  ]);
  nodeTool("node_modules/typescript/bin/tsc", [
    "-p",
    "tsconfig.build.json",
    "--outDir",
    join(application, "build-server"),
    "--sourceMap",
    "false",
  ]);
  await cp(
    join(root, "server/production/sqlite-migrations"),
    join(application, "build-server/server/production/sqlite-migrations"),
    { recursive: true },
  );
  for (const file of ["package.json", "package-lock.json"])
    await copyFile(join(root, file), join(application, file));
  await copyFile(
    join(root, "deploy/Dockerfile"),
    join(application, "Dockerfile"),
  );
  await writeFile(
    join(application, ".dockerignore"),
    "node_modules\n.env\ndata\n",
  );

  const compose = (await readFile(join(root, "compose.yaml"), "utf8")).replace(
    /\r\n/g,
    "\n",
  );
  if (!/^    build: \.$/m.test(compose))
    throw new Error("compose.yaml 构建路径发生变化，请检查打包配置");
  await writeFile(
    join(staging, "compose.yaml"),
    compose.replace(/^    build: \.$/m, "    build: ./build-mirror"),
  );
  await copyFile(join(root, "changelog.md"), join(staging, "changelog.md"));
  // Use an ASCII archive filename for consistent Windows/Linux tar encoding.
  await copyFile(join(root, "部署说明.md"), join(staging, "DEPLOY.md"));
  await access(join(application, "dist/index.html"));
  await access(join(application, "build-server/server/production/main.js"));

  const temporaryArchive = join(staging, "tuxu-app.tar.gz");
  run(
    "tar",
    [
      "-czf",
      temporaryArchive,
      "compose.yaml",
      "changelog.md",
      "DEPLOY.md",
      "build-mirror",
    ],
    staging,
  );
  await copyFile(temporaryArchive, archive);
  console.log(`部署包已生成：${archive}`);
  console.log(
    "解压后只有 compose.yaml、changelog.md、DEPLOY.md（部署说明）和 build-mirror/ 程序目录。",
  );
} finally {
  if (
    dirname(resolve(staging)) !== temporaryRoot ||
    !basename(staging).startsWith("tuxu-deploy-")
  )
    throw new Error("拒绝清理非打包临时目录");
  await rm(staging, { recursive: true, force: true });
}
