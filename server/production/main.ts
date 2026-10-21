import { database, migrate } from "./database.js";
import { createApp } from "./app.js";
import { Worker } from "./worker.js";
import { GrsaiProvider } from "./provider.js";
const mode = process.argv[2] || "all";
if (!["all", "migrate"].includes(mode))
  throw new Error("SQLite 运行方式为 all（API 与队列同进程）或 migrate");
const db = database(process.env.DATABASE_PATH || "./data/workspace.sqlite");
await migrate(db);
if (mode === "migrate") {
  await db.close();
  process.exit(0);
}
const { app, workflows } = await createApp({
  db,
  assetDirectory: process.env.ASSET_DIRECTORY || "./data/assets",
  credentialSecret: process.env.CREDENTIAL_SECRET || "",
  password: process.env.APP_PASSWORD || "",
  staticDirectory: process.env.NODE_ENV === "production" ? "./dist" : undefined,
});
const worker = new Worker(
  workflows,
  new GrsaiProvider(workflows.assets, (event) =>
    app.log.info(event, "platform diagnostic"),
  ),
  (error) => {
    if ((error as any)?.event === "prompt.completed") {
      app.log.info(error as object, "prompt completed");
    } else
      app.log.error(
        error instanceof Error ? { errorType: error.name } : (error as object),
        "worker stage failed",
      );
  },
);
await app.listen({
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3001),
});
worker.start();
app.log.info(
  { database: process.env.DATABASE_PATH || "./data/workspace.sqlite" },
  "SQLite 工作区与任务队列已启动",
);
for (const job of (await workflows.repo.view()).jobs.filter(
  (job) => job.status === "interrupted",
))
  app.log.warn(
    {
      event: "task.interrupted.on-start",
      jobId: job.id,
      kind: job.kind,
      stage: job.stage,
      error: job.error,
      createdAt: job.createdAt,
    },
    "发现之前中断的任务，未重新提交",
  );
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await worker?.stop();
  await app.close();
  await db.close();
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
