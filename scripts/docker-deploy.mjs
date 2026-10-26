import { readFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { run, main, shellQuote as q, defaultBundle } from "./docker-common.mjs";
import { validateDomain } from "./docker-configure.mjs";

main(async () => {
  const { values } = parseArgs({
    options: {
      host: { type: "string" },
      "ssh-port": { type: "string", default: "22" },
      dir: { type: "string", default: "/opt/tuxu" },
      bundle: { type: "string", default: defaultBundle },
      domain: { type: "string", default: "" },
      project: { type: "string", default: "tuxu" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "npm run docker:deploy -- --host root@服务器IP [--domain 完整域名] [--dir /opt/tuxu] [--bundle 部署包目录] [--ssh-port 22] [--project tuxu]",
    );
    return;
  }
  if (
    !/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(
      values.host || "",
    )
  )
    throw new Error("请通过 --host 指定 SSH 地址，例如 root@192.0.2.10。");
  const remote = values.dir;
  if (!/^\/[a-zA-Z0-9_/-]+$/.test(remote) || remote === "/")
    throw new Error(
      "--dir 需要是 Linux 绝对目录，仅使用字母、数字、下划线、横线和斜杠。",
    );
  if (
    !/^\d+$/.test(values["ssh-port"]) ||
    +values["ssh-port"] < 1 ||
    +values["ssh-port"] > 65535
  )
    throw new Error("无效的 SSH 端口。");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(values.project))
    throw new Error("无效的 Compose 项目名。");
  validateDomain(values.domain);
  const bundle = resolve(values.bundle);
  const manifest = JSON.parse(
    await readFile(join(bundle, "manifest.json"), "utf8"),
  );
  // Legacy image bundles did not have a kind field.
  const kind = manifest.kind || "image";
  if (
    !["image", "runtime"].includes(kind) ||
    manifest.archive !==
      (kind === "image" ? "tuxu-image.tar" : "tuxu-app.tar.gz") ||
    !["linux/amd64", "linux/arm64"].includes(manifest.platform) ||
    !/^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(manifest.image)
  )
    throw new Error("部署包 manifest.json 无效，请重新运行 docker:pack。");
  const files = [manifest.archive, "configure.mjs", "manifest.json"].map(
    (name) => join(bundle, name),
  );
  for (const file of files) await access(file);
  if (manifest.version && !/^\d+\.\d+\.\d+$/.test(manifest.version))
    throw new Error("部署包版本号无效。");
  if (
    manifest.version &&
    (!/^[a-f0-9]{64}$/.test(manifest.sha256 || "") ||
      manifest.sha256 !==
        createHash("sha256")
          .update(await readFile(files[0]))
          .digest("hex"))
  )
    throw new Error("部署包校验失败，文件可能不完整，请重新打包或传输。");
  const ssh = (command) =>
    run("ssh", ["-p", values["ssh-port"], values.host, command]);
  ssh(
    `docker info >/dev/null && docker compose version && mkdir -p ${q(remote)}`,
  );
  console.log("上传部署包……（SSH 可能提示输入密码）");
  run("scp", ["-P", values["ssh-port"], ...files, `${values.host}:${remote}/`]);
  const configureArgs = [
    "--image",
    manifest.image,
    "--project",
    values.project,
  ];
  if (values.domain) configureArgs.push("--domain", values.domain);
  const prepareImage =
    kind === "image"
      ? "docker load -i tuxu-image.tar"
      : `docker build --platform ${q(manifest.platform)} --tag ${q(manifest.image)} --file Dockerfile.runtime - < tuxu-app.tar.gz`;
  const healthCheck = `let healthy = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch('http://127.0.0.1:3001/health', { signal: AbortSignal.timeout(2000) });
    if (response.ok && (await response.json()).status === 'ok') { healthy = true; break; }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!healthy) { console.error('应用健康检查失败，请查看 docker compose logs app'); process.exit(1); }
${
  manifest.version
    ? `const version = await (await fetch('http://127.0.0.1:3001/version.json', { cache: 'no-store' })).json();
if (version.version !== ${JSON.stringify(manifest.version)}) { console.error('应用版本与部署包不一致'); process.exit(1); }`
    : ""
}
console.log('应用健康检查通过');`;
  const rememberVersion = manifest.version
    ? ` && mkdir -p release-history && cp manifest.json ${q(`release-history/v${manifest.version}.json`)} && cp manifest.json release-history/current.json`
    : "";
  // Remote Node.js comes from the application image. All user input is quoted;
  // no local shell is used, and the server does not need a Node installation.
  ssh(
    `cd ${q(remote)} && ${prepareImage} && docker run --rm --user "$(id -u):$(id -g)" --entrypoint node -v ${q(`${remote}:/deploy`)} ${q(manifest.image)} /deploy/configure.mjs ${configureArgs.map(q).join(" ")} && docker compose -f compose.yaml config --quiet && docker compose -f compose.yaml up -d --force-recreate && docker compose -f compose.yaml exec -T app node --input-type=module -e ${q(healthCheck)}${rememberVersion} && docker compose -f compose.yaml ps`,
  );
  console.log(
    `\n容器已启动，应用健康检查通过。${manifest.version ? `当前版本：v${manifest.version}。更新日志：/updates/。` : ""}登录用户名：admin。\n密码：服务器 ${remote}/.env 的 APP_PASSWORD（首次部署随机生成）。\n域名访问需要 DNS 指向服务器并放行 80/443；未配置域名时通过 SSH 隧道访问。\n查看日志：在服务器 ${remote} 运行 docker compose -f compose.yaml logs --tail=100 app\nHTTPS 证书与公网访问请再通过浏览器确认。`,
  );
});
