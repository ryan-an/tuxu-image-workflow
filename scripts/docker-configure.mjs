// Runs inside the loaded application image; the server needs Docker, not Node.js.
import { readFile, writeFile, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

export function validateDomain(domain) {
  if (
    domain &&
    (domain.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain))
  )
    throw new Error("domain 请填写完整域名，不带协议、端口或路径。");
}

export async function configure(
  directory,
  { image, domain = "", project = "tuxu" },
) {
  validateDomain(domain);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project))
    throw new Error("无效的 Compose 项目名。");
  if (!/^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(image))
    throw new Error("无效的镜像标签。");
  // Remember HTTPS settings when subsequent updates omit --domain.
  const settingsFile = join(directory, "deployment.json");
  let previous;
  try {
    previous = JSON.parse(await readFile(settingsFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (previous && previous.project !== project)
    throw new Error(
      "此目录已有其他 Compose 项目，不能切换项目名以免挂载到空数据卷。",
    );
  domain ||= previous?.domain || "";
  validateDomain(domain);
  // Give the local HTTPS proxy a stable, private peer address. The merged
  // authentication policy only trusts this peer, never arbitrary forwarded headers.
  const networkBytes = randomBytes(2);
  const proxySubnet = domain
    ? previous?.proxySubnet ||
      `172.30.${networkBytes[0]}.${networkBytes[1] & 248}/29`
    : "";
  if (
    proxySubnet &&
    !/^172\.30\.(?:\d{1,3})\.(?:\d{1,3})\/29$/.test(proxySubnet)
  )
    throw new Error("已有部署的代理网络配置无效，请恢复 deployment.json。");
  const proxyParts = proxySubnet.split("/")[0].split(".").map(Number);
  if (domain && (proxyParts.some((part) => part > 255) || proxyParts[3] % 8))
    throw new Error("已有部署的代理网络配置无效，请恢复 deployment.json。");
  const proxyAddress = domain
    ? [...proxyParts.slice(0, 3), proxyParts[3] + 2].join(".")
    : "";
  // Do not adopt an existing unrelated Compose installation implicitly.
  if (!previous) {
    try {
      await access(join(directory, "compose.yaml"));
      throw new Error(
        "目录已有 compose.yaml，请使用新的部署目录，或先迁移原有部署。",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const envPath = join(directory, ".env");
  if (previous) {
    try {
      await access(envPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      throw new Error(
        "已有部署的 .env 丢失，请从备份恢复原密钥；不会生成替代密钥。",
      );
    }
  }
  try {
    await writeFile(
      envPath,
      `APP_PASSWORD=${randomBytes(24).toString("hex")}\nCREDENTIAL_SECRET=${randomBytes(32).toString("hex")}\n`,
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const env = parseEnv(await readFile(envPath, "utf8"));
  if (!env.APP_PASSWORD || !/^[a-f0-9]{64}$/i.test(env.CREDENTIAL_SECRET || ""))
    throw new Error(
      "现有 .env 缺少有效密码或加密密钥，请修复原文件；不会自动替换旧密钥。",
    );

  const proxy = domain
    ? `
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app
    networks:
      proxy:
        ipv4_address: ${proxyAddress}
`
    : "";
  const compose = `name: ${project}
services:
  app:
    image: ${image}
    environment:
      DATABASE_PATH: /app/data/workspace.sqlite
      ASSET_DIRECTORY: /app/data/assets
      CREDENTIAL_SECRET: \${CREDENTIAL_SECRET:?Missing CREDENTIAL_SECRET}
      APP_PASSWORD: \${APP_PASSWORD:?Missing APP_PASSWORD}
      REQUIRE_HTTPS: \${REQUIRE_HTTPS:-false}
      TRUSTED_PROXIES: ${domain ? proxyAddress : '"${TRUSTED_PROXIES:-}"'}
      PUBLIC_ORIGIN: ${domain ? `https://${domain}` : '"${PUBLIC_ORIGIN:-}"'}
    ports:
      - "127.0.0.1:3001:3001"
    volumes:
      - workspace:/app/data
    restart: unless-stopped
${domain ? "    networks:\n      - proxy\n" : ""}
${proxy}
volumes:
  workspace:
${domain ? `  caddy_data:\n  caddy_config:\nnetworks:\n  proxy:\n    ipam:\n      config:\n        - subnet: ${proxySubnet}\n` : ""}`;
  if (domain)
    await writeFile(
      join(directory, "Caddyfile"),
      `${domain} {\n    reverse_proxy app:3001 {\n        flush_interval -1\n    }\n}\n`,
    );
  await writeFile(join(directory, "compose.yaml"), compose);
  await writeFile(
    settingsFile,
    JSON.stringify(
      { project, domain, ...(domain ? { proxySubnet } : {}) },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `部署配置已就绪；密码和加密密钥保存在服务器 ${envPath}，更新时保留。`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const { values } = parseArgs({
    options: {
      directory: { type: "string", default: "/deploy" },
      image: { type: "string" },
      domain: { type: "string", default: "" },
      project: { type: "string", default: "tuxu" },
    },
  });
  configure(values.directory, values).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
