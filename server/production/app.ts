import Fastify, { LogController } from "fastify";
import staticFiles from "@fastify/static";
import { extname, resolve } from "node:path";
import { Repository } from "./repository.js";
import { Assets, downloadImage } from "./assets.js";
import { Credentials } from "./credentials.js";
import { Workflows } from "./workflows.js";
import { AppError, type Database } from "./types.js";
import { registerAuthentication } from "./authentication.js";
import { registerAssistant } from "./assistant.js";
export interface AppOptions {
  db: Database;
  assetDirectory: string;
  credentialSecret: string;
  password: string;
  staticDirectory?: string;
  logger?: boolean;
}
export async function createApp(options: AppOptions) {
  if (!options.password) throw new Error("APP_PASSWORD 不能为空");
  const repo = new Repository(options.db);
  await repo.initialize();
  const assets = new Assets(options.db, options.assetDirectory);
  const workflows = new Workflows(
    repo,
    assets,
    new Credentials(options.credentialSecret),
  );
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 128 * 1024 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
    requestTimeout: 30000,
  });
  const auth = registerAuthentication(app, options.password);
  await registerAssistant(app, workflows);
  app.setErrorHandler((error, request, reply) => {
    // Never log request bodies, credentials or upstream response payloads.
    const status = (error as any).statusCode || 500;
    const detail = error instanceof Error ? error : new Error("服务处理失败");
    if (error instanceof AppError && error.diagnostic)
      app.log.warn(
        { requestId: request.id, ...error.diagnostic },
        "product validation failed",
      );
    if (status >= 500)
      app.log.error(
        { requestId: request.id, errorType: detail.name },
        "request failed",
      );
    const message = status < 500 ? detail.message : "服务处理失败，请稍后重试";
    reply.code(status).send({ error: message, requestId: request.id });
  });
  app.get("/health", async () => {
    await options.db.query("SELECT 1");
    return { status: "ok" };
  });
  app.get("/api/workflow/settings", () => workflows.settings());
  const streams = new Set<import("node:http").ServerResponse>();
  app.addHook("preClose", async () => {
    for (const stream of streams) stream.end();
  });
  app.get("/api/analysis/events", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    streams.add(reply.raw);
    const send = (event: any) => {
      if (!auth.authenticated(request)) return reply.raw.end();
      if (
        !reply.raw.destroyed &&
        !reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
      )
        reply.raw.end(); // Reconnection receives the latest snapshot instead of an unbounded backlog.
    };
    workflows.analysisEvents.on("progress", send);
    for (const event of workflows.analysisEvents.latest.values()) send(event);
    const heartbeat = setInterval(() => {
      if (!auth.authenticated(request)) return reply.raw.end();
      if (!reply.raw.destroyed) reply.raw.write(": heartbeat\n\n");
    }, 15000);
    reply.raw.once("close", () => {
      clearInterval(heartbeat);
      streams.delete(reply.raw);
      workflows.analysisEvents.off("progress", send);
    });
  });
  app.post(
    "/api/workflow/settings",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            [
              "baseUrl",
              "imageModel",
              "promptModel",
              "promptProvider",
              "aspectRatio",
              "imageSize",
              "gptSize",
              "quality",
              "mode",
              "apiKey",
              "promptApiKey",
            ]
              .map((k) => [k, { type: "string", maxLength: 4096 }])
              .concat([
                ["clearKey", { type: "boolean" }],
                ["clearPromptKey", { type: "boolean" }],
              ] as any),
          ),
        },
      },
    },
    (request) => workflows.updateSettings(request.body as any),
  );
  app.get("/api/workspace", () =>
    repo.db.transaction(async (tx) => {
      await repo.lock(tx);
      return { ...(await repo.view(tx)), syncCursor: await repo.cursor(tx) };
    }),
  );
  app.get<{ Querystring: { since: number } }>(
    "/api/workspace/changes",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["since"],
          additionalProperties: false,
          properties: {
            since: {
              type: "integer",
              minimum: 0,
              maximum: Number.MAX_SAFE_INTEGER,
            },
          },
        },
      },
    },
    (request) =>
      repo.db.transaction((tx) => repo.changes(tx, request.query.since)),
  );
  app.patch(
    "/api/workspace",
    {
      schema: {
        body: {
          type: "object",
          required: ["edits"],
          additionalProperties: false,
          properties: {
            edits: {
              type: "array",
              maxItems: 10000,
              items: {
                type: "object",
                required: ["path", "before", "value"],
                additionalProperties: false,
                properties: {
                  path: {
                    type: "array",
                    minItems: 1,
                    maxItems: 5,
                    items: { type: "string", maxLength: 200 },
                  },
                  before: {},
                  value: {},
                },
              },
            },
          },
        },
      },
    },
    (request) => workflows.edit((request.body as any).edits),
  );
  app.post(
    "/api/workspace/import",
    {
      schema: {
        body: {
          type: "object",
          required: ["commandId", "workspace"],
          additionalProperties: false,
          properties: {
            commandId: { type: "string", minLength: 1, maxLength: 100 },
            workspace: { type: "object" },
          },
        },
      },
    },
    (request) => {
      const body = request.body as any;
      return workflows.importWorkspace(body.commandId, body.workspace);
    },
  );
  app.get(
    "/api/jobs/history",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            page: { type: "integer", minimum: 1, maximum: 1000000, default: 1 },
            pageSize: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 50,
            },
            status: {
              type: "string",
              enum: [
                "all",
                "active",
                "attention",
                "queued",
                "running",
                "failed",
                "interrupted",
                "completed",
                "cancelled",
              ],
              default: "all",
            },
            search: { type: "string", maxLength: 500, default: "" },
          },
        },
      },
    },
    (request) => {
      const query = request.query as {
        page: number;
        pageSize: number;
        status: string;
        search: string;
      };
      return workflows.repo.history(
        query.page,
        query.pageSize,
        query.status,
        query.search,
      );
    },
  );
  app.post(
    "/api/jobs",
    {
      schema: {
        body: {
          type: "object",
          required: ["commandId", "pairs", "kind"],
          additionalProperties: false,
          properties: {
            commandId: { type: "string", minLength: 1, maxLength: 100 },
            kind: {
              type: "string",
              enum: [
                "prompt",
                "prompt-set",
                "image",
                "workflow",
                "full-workflow",
              ],
            },
            pairs: {
              type: "array",
              minItems: 1,
              maxItems: 3000,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["productId", "taskId"],
                properties: {
                  productId: { type: "string" },
                  taskId: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    (request) => {
      const body = request.body as any;
      return workflows.enqueue(body.commandId, body.pairs, body.kind);
    },
  );
  app.post(
    "/api/jobs/:id/control",
    {
      schema: {
        body: {
          type: "object",
          required: ["commandId", "action"],
          additionalProperties: false,
          properties: {
            commandId: { type: "string", minLength: 1, maxLength: 100 },
            action: {
              type: "string",
              enum: [
                "pause",
                "cancel",
                "retry",
                "reconcile",
                "cancel-pending",
                "cancel-product",
              ],
            },
            paused: { type: "boolean" },
            productId: { type: "string", maxLength: 100 },
            remoteId: { type: "string", maxLength: 200 },
            confirmNotAccepted: { type: "boolean" },
          },
        },
      },
    },
    (request) => {
      const body = request.body as any;
      return workflows.control((request.params as any).id, body.action, body);
    },
  );
  app.post(
    "/api/assets",
    {
      bodyLimit: 56 * 1024 * 1024,
      schema: {
        body: {
          type: "object",
          required: ["source"],
          additionalProperties: false,
          properties: {
            source: { type: "string", maxLength: 56 * 1024 * 1024 },
          },
        },
      },
    },
    async (request) => {
      const source = (request.body as any).source;
      if (!source.startsWith("data:image/"))
        throw new AppError("请上传图片内容");
      return { source: await assets.normalize(source) };
    },
  );
  app.get("/api/assets/:id", async (request, reply) => {
    const asset = await assets.get((request.params as any).id);
    return reply
      .header("Cache-Control", "private, max-age=31536000, immutable")
      .type(asset.mime)
      .send(asset.bytes);
  });
  app.get("/api/assets/:id/thumbnail", async (request, reply) => {
    const asset = await assets.thumbnail((request.params as any).id);
    return reply
      .header("Cache-Control", "private, max-age=31536000, immutable")
      .type(asset.mime)
      .send(asset.bytes);
  });
  app.post(
    "/api/shimo-image",
    {
      schema: {
        body: {
          type: "object",
          required: ["url"],
          additionalProperties: false,
          properties: { url: { type: "string", maxLength: 12000 } },
        },
      },
    },
    async (request, reply) => {
      const url = new URL((request.body as any).url);
      if (
        url.hostname !== "uploader.shimo.im" ||
        !/^\/f\/[^/]+\.(png|jpe?g|webp|gif)$/i.test(url.pathname)
      )
        throw new AppError("不支持的石墨地址");
      const image = await downloadImage(url.href, AbortSignal.timeout(20000), [
        "uploader.shimo.im",
        "oimages2.shimonote.com",
      ]);
      return reply.type(image.mime).send(image.bytes);
    },
  );
  if (options.staticDirectory) {
    await app.register(staticFiles, {
      root: resolve(options.staticDirectory),
      // Resolve from disk on each request so builds made while the server is
      // running can introduce new content-hashed modules without a restart.
      wildcard: true,
      setHeaders(reply, filename) {
        if (extname(filename) === ".html")
          reply.header("Cache-Control", "no-store");
      },
    });
    app.setNotFoundHandler((request, reply) => {
      const pathname = request.url.split("?")[0];
      reply.header("Cache-Control", "no-store");
      if (pathname.startsWith("/api/"))
        return reply.code(404).send({ error: "接口不存在" });
      if (
        !["GET", "HEAD"].includes(request.method) ||
        pathname.startsWith("/assets/") ||
        extname(pathname)
      )
        return reply.code(404).send({ error: "静态资源不存在，请刷新页面" });
      return reply.sendFile("index.html");
    });
  }
  return { app, workflows };
}
