import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";

export const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
export async function setupLocal() {
  const filename = join(projectDirectory, ".env");
  let contents = "",
    exists = false;
  try {
    contents = await readFile(filename, "utf8");
    exists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const current = parseEnv(contents);
  const defaults = {
    DATABASE_PATH: "./data/workspace.sqlite",
    ASSET_DIRECTORY: "./data/assets",
    CREDENTIAL_SECRET: randomBytes(32).toString("hex"),
    APP_PASSWORD: "admin",
    HOST: "127.0.0.1",
    PORT: "3001",
    NODE_ENV: "production",
  };
  const additions = Object.entries(defaults).filter(([key]) => !current[key]);
  if (additions.length) {
    const updated =
      contents +
      (contents.endsWith("\n") || !contents ? "" : "\n") +
      "# Local SQLite runtime (generated; do not commit)\n" +
      additions.map(([key, value]) => `${key}=${value}\n`).join("");
    try {
      await writeFile(filename, updated, {
        flag: exists ? "w" : "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (!exists && error.code === "EEXIST") return setupLocal();
      throw error;
    }
  }
  await mkdir(join(projectDirectory, "data"), { recursive: true });
  const configured = parseEnv(await readFile(filename, "utf8"));
  if (
    !/^[a-f0-9]{64}$/i.test(configured.CREDENTIAL_SECRET || "") ||
    !configured.APP_PASSWORD
  )
    throw new Error(".env 中的加密主密钥或登录密码无效，请检查配置");
  console.log("SQLite 本地配置已就绪，无需安装数据库服务。");
  console.log(
    `工作区：http://${configured.HOST}:${configured.PORT}  用户名：admin`,
  );
  console.log(`登录密码：${configured.APP_PASSWORD}`);
  return configured;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await setupLocal();
