import { access, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { setupLocal, projectDirectory } from "./setup-local.mjs";

process.chdir(projectDirectory);
const desktop = process.env.TUXU_DESKTOP === "1";
const desktopState = (state) => console.log(`TUXU_DESKTOP:${JSON.stringify(state)}`);
try {
  await access(join(projectDirectory, "data/.update.lock"));
  throw new Error("程序正在更新或备份，请等待完成后再启动图序。");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const password = randomBytes(18).toString("base64url");
try {
  await writeFile(join(projectDirectory, ".env"), [
    "HOST=0.0.0.0", "PORT=3001", "NODE_ENV=production", "REQUIRE_HTTPS=false",
    "DATABASE_PATH=./data/workspace.sqlite", "ASSET_DIRECTORY=./data/assets",
    `APP_PASSWORD=${password}`, `CREDENTIAL_SECRET=${randomBytes(32).toString("hex")}`, "",
  ].join("\n"), { flag: "wx", mode: 0o600 });
  if (desktop) desktopState({ type: "bootstrap", username: "admin", password });
  else {
    console.log(`首次启动，管理员：admin  初始密码：${password}`);
    console.log("请妥善保存密码；以后可在 .env 中修改 APP_PASSWORD 并重启。请勿分享 .env。");
  }
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
// Portable Windows deployments keep the migration boundary beside the program.
// Existing values are preserved so upgrades never replace the encryption key.
const config = await setupLocal({ quiet: true });
const expectedDatabase = resolve(projectDirectory, "data/workspace.sqlite");
const expectedAssets = resolve(projectDirectory, "data/assets");
if (
  resolve(projectDirectory, config.DATABASE_PATH || "./data/workspace.sqlite") !== expectedDatabase ||
  resolve(projectDirectory, config.ASSET_DIRECTORY || "./data/assets") !== expectedAssets
)
  throw new Error("便携版要求 DATABASE_PATH 和 ASSET_DIRECTORY 位于程序旁的 data 目录；请迁移旧数据后修正 .env");
const scheme = config.TLS_CERT_FILE && config.TLS_KEY_FILE ? "https" : "http";
const origin = `${scheme}://127.0.0.1:${config.PORT}`;
const addresses = [origin];
if (!desktop) console.log(`本机访问：${origin}`);
if (config.HOST === "0.0.0.0") {
  for (const entries of Object.values(networkInterfaces()))
    for (const address of entries || [])
      if (address.family === "IPv4" && !address.internal)
        {
          const url = `${scheme}://${address.address}:${config.PORT}`;
          addresses.push(url);
          if (!desktop) console.log(`局域网候选地址：${url}`);
        }
}
if (desktop) desktopState({ type: "configuration", origin, addresses: addresses.join("\n") });
else console.log("关闭此窗口将停止服务。备份前先用 Ctrl+C 停止，再复制整个 data 目录和 .env。");
await import("./start-local.mjs");
