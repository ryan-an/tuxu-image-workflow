import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { emitKeypressEvents } from "node:readline";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  database,
  migrate,
} from "../build-server/server/production/database.js";
import { Provisioning } from "../build-server/server/production/provisioning.js";
import { Repository } from "../build-server/server/production/repository.js";

async function hiddenPassword(label) {
  if (!process.stdin.isTTY)
    throw new Error("非交互环境请通过 TUXU_TEAM_PASSWORD 环境变量提供密码");
  process.stdout.write(label);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolvePassword, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.off("keypress", keypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const keypress = (text, key) => {
      if (key?.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("已取消"));
      } else if (key?.name === "return") {
        cleanup();
        resolvePassword(value);
      } else if (key?.name === "backspace")
        value = Array.from(value).slice(0, -1).join("");
      else if (text && !key?.ctrl && !key?.meta) value += text;
    };
    process.stdin.on("keypress", keypress);
  });
}

const root = fileURLToPath(new URL("../", import.meta.url));
const [action, ...args] = process.argv.slice(2);
const flags = new Map();
if (args.length && !args[0].startsWith("--")) {
  flags.set("--username", args[0]);
  if (action === "create") flags.set("--name", args[1]);
  if (args.length > (action === "create" ? 2 : 1)) throw new Error("参数过多");
} else
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--username", "--name", "--display-name"].includes(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new Error("参数无效；使用 npm run teams -- create team_b 团队名称");
    flags.set(args[i], args[i + 1]);
  }
if (!["create", "list", "reset-password"].includes(action))
  throw new Error(
    "用法：npm run teams -- create team_b B团队；或 list；或 reset-password team_b",
  );
if (action !== "list" && !flags.get("--username"))
  throw new Error("请提供管理员用户名");
if (action === "create" && !flags.get("--name"))
  throw new Error("请提供团队名称");
let local = {};
try {
  local = parseEnv(await readFile(resolve(root, ".env"), "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const config = { ...local, ...process.env };
const db = database(
  resolve(root, config.DATABASE_PATH || "./data/workspace.sqlite"),
);
try {
  await migrate(db);
  await new Repository(db).initialize();
  const accounts = new Provisioning(db);
  if (action === "list") console.table(await accounts.teamOwners());
  else {
    const username = flags.get("--username");
    if (!username) throw new Error("请提供 --username");
    const password =
      process.env.TUXU_TEAM_PASSWORD ||
      (await hiddenPassword("新管理员密码（至少 10 个字符，不回显）："));
    if (
      !process.env.TUXU_TEAM_PASSWORD &&
      password !== (await hiddenPassword("再次输入密码："))
    )
      throw new Error("两次密码不一致");
    if (action === "create") {
      if (!flags.get("--name")) throw new Error("请提供 --name 团队名称");
      const result = await accounts.provisionTeam({
        username,
        password,
        workspaceName: flags.get("--name"),
        displayName: flags.get("--display-name"),
      });
      console.log(
        `已创建团队：${result.workspaceName}；管理员：${result.username}；工作区：${result.workspaceId}`,
      );
    } else {
      await accounts.resetOwnerPassword(username, password);
      console.log("管理员密码已重置，旧登录已失效。");
    }
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
