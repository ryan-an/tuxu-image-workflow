import { database, migrate } from "./database.js";
import { createApp } from "./app.js";
import { WorkspaceWorkers } from "./workspace-workers.js";
import { loadTransportSecurity } from "./transport-security.js";
import { executionLimitsFromEnv } from "./execution-limits.js";
const mode = process.argv[2] || "all";
if (!["all", "migrate"].includes(mode))
  throw new Error("SQLite 运行方式为 all（API 与队列同进程）或 migrate");
const transport =
  mode === "migrate" ? undefined : await loadTransportSecurity(process.env);
const db = database(process.env.DATABASE_PATH || "./data/workspace.sqlite");
try {
  await migrate(db);
} catch (error) {
  await db.close();
  console.error(
    `数据库升级失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
if (mode === "migrate") {
  await db.close();
  process.exit(0);
}
const { app, workspaces } = await createApp({
  db,
  assetDirectory: process.env.ASSET_DIRECTORY || "./data/assets",
  credentialSecret: process.env.CREDENTIAL_SECRET || "",
  password: process.env.APP_PASSWORD || "",
  staticDirectory: process.env.NODE_ENV === "production" ? "./dist" : undefined,
  transport,
  executionLimits: executionLimitsFromEnv(process.env),
});
const worker = new WorkspaceWorkers(
  workspaces,
  (error) => {
    if ((error as any)?.event === "prompt.completed") {
      app.log.info(error as object, "prompt completed");
    } else
      app.log.error(
        error instanceof Error ? { errorType: error.name } : (error as object),
        "worker stage failed",
      );
  },
  (event) => app.log.info(event as object, "platform diagnostic"),
);
await app.listen({
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3001),
});
await worker.start();
const collectAssets = async () => {
  try {
    for (const workflows of await workspaces.all())
      await workflows.assets.collectUnused();
  } catch (error) {
    app.log.error(
      { errorType: (error as Error).name },
      "unused asset cleanup failed",
    );
  }
};
await collectAssets();
const assetCleanupTimer = setInterval(
  () => void collectAssets(),
  60 * 60 * 1000,
);
assetCleanupTimer.unref();
app.log.info(
  { database: process.env.DATABASE_PATH || "./data/workspace.sqlite" },
  "SQLite 工作区与任务队列已启动",
);
for (const job of (
  await Promise.all((await workspaces.all()).map((w) => w.repo.view()))
)
  .flatMap((state) => state.jobs)
  .filter((job) => job.status === "interrupted"))
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
  clearInterval(assetCleanupTimer);
  await worker?.stop();
  await app.close();
  await db.close();
  if (process.connected) process.disconnect?.();
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
process.on("message", (message) => {
  if ((message as { type?: string })?.type === "shutdown") void close();
});
process.once("disconnect", () => void close());
if (process.connected && process.send) process.send({ type: "ready" });
