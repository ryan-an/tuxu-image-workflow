import { readFile, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { setupLocal, projectDirectory } from "./setup-local.mjs";
import { createLocalCertificate } from "./https-certificate.mjs";

const config = await setupLocal({ quiet: true });
if (config.TLS_CERT_FILE || config.TLS_KEY_FILE)
  throw new Error(
    "已有 TLS 配置，已保留现有证书。若需要更换，请先在 .env 移除 TLS_CERT_FILE / TLS_KEY_FILE。",
  );
const explicitHosts = process.argv.slice(2);
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && !n.internal && n.family === "IPv4")
  .map((n) => n.address);
const hosts = [
  ...explicitHosts,
  ...addresses,
  ...(!["0.0.0.0", "::"].includes(config.HOST) ? [config.HOST] : []),
];
const { key, cert, ca } = await createLocalCertificate(
  join(projectDirectory, "data", "tls"),
  hosts,
);
const envPath = join(projectDirectory, ".env");
const contents = await readFile(envPath, "utf8");
const updates = {
  TLS_CERT_FILE: "./data/tls/server-cert.pem",
  TLS_KEY_FILE: "./data/tls/server-key.pem",
  TLS_CA_FILE: "./data/tls/local-ca.pem",
};
let updated = contents;
for (const [name, value] of Object.entries(updates)) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  updated = pattern.test(updated)
    ? updated.replace(pattern, line)
    : `${updated.trimEnd()}\n${line}\n`;
}
await writeFile(envPath, updated, { mode: 0o600 });
const certificate = new X509Certificate(await readFile(ca));
console.log("已生成本机/IP 的 HTTPS 证书并写入 .env，重启服务后生效。");
console.log(`本机入口：https://127.0.0.1:${config.PORT}`);
console.log(`需要导入到访问设备的本地 CA 证书：${ca}`);
console.log(`SHA-256 指纹：${certificate.fingerprint256}`);
console.log(
  "浏览器需信任此 CA 才能验证服务器身份；请核对指纹后导入证书。脚本不会修改系统信任库。",
);
console.log(`私钥仅留在服务端：${key}，不要分发任何 *-key.pem 文件。`);
