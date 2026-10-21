// Check the saved Doubao connection without printing credentials or product data.
import SQLite from "better-sqlite3";
import { Credentials } from "../build-server/server/production/credentials.js";
import { DOUBAO_BASE_URL } from "../shared/doubao.js";

process.loadEnvFile(".env");
const db = new SQLite(process.env.DATABASE_PATH || "data/workspace.sqlite", {
  readonly: true,
});
const row = db
  .prepare("SELECT document,prompt_credential FROM workspace WHERE id=?")
  .get("default");
db.close();
if (!row?.prompt_credential) throw new Error("请先配置豆包 API Key");
const key = new Credentials(process.env.CREDENTIAL_SECRET).decrypt(
  row.prompt_credential,
);
const config = JSON.parse(row.document).settings;
const response = await fetch(`${DOUBAO_BASE_URL}/responses`, {
  method: "POST",
  signal: AbortSignal.timeout(30000),
  redirect: "error",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: config.promptModel,
    input: "仅回复 OK",
    max_output_tokens: 16,
    thinking: { type: "disabled" },
    store: false,
  }),
});
const data = await response.json();
const safe = (value) =>
  typeof value === "string" ? value.replaceAll(key, "[已隐藏]") : value;
console.log(
  JSON.stringify(
    {
      endpoint: `${DOUBAO_BASE_URL}/responses`,
      model: config.promptModel,
      status: response.status,
      code: safe(data.error?.code),
      message: safe(data.error?.message),
      requestId: response.headers.get("x-request-id"),
      text: response.ok
        ? data.output
            ?.filter((item) => item.type === "message")
            .flatMap((item) => item.content || [])
            .filter((item) => item.type === "output_text")
            .map((item) => item.text)
            .join("")
        : undefined,
    },
    null,
    2,
  ),
);
