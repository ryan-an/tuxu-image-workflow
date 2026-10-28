import Fastify, { LogController } from "fastify";
import staticFiles from "@fastify/static";
import compress from "@fastify/compress";
import { constants as zlibConstants } from "node:zlib";
import { basename, extname, resolve } from "node:path";
import {
  requestedWorkspaceView,
  readWorkspace,
  presentWorkspace,
  readWorkspaceJobs,
} from "./workspace-loading.js";
import { downloadImage } from "./assets.js";
import { AppError, type Database } from "./types.js";
import { registerAuthentication } from "./authentication.js";
import { registerAssistant } from "./assistant.js";
import { Accounts } from "./accounts.js";
import { registerMemberRoutes } from "./member-routes.js";
import { Workspaces } from "./workspaces.js";
import { WorkspaceDirectory } from "./workspace-directory.js";
import { registerWorkspaceRoutes } from "./workspace-routes.js";
import { registerCollaborationRoutes } from "./collaboration-routes.js";
import { registerQueueProgress } from "./queue-progress.js";
import {
  registerTransportSecurity,
  type TransportSecurityOptions,
} from "./transport-security.js";
import { registerSheetImports } from "./sheet-imports.js";
import type { ExecutionLimits } from "./execution-limits.js";
export interface AppOptions {
  executionLimits?: ExecutionLimits;
  db: Database;
  assetDirectory: string;
  credentialSecret: string;
  password: string;
  staticDirectory?: string;
  logger?: boolean;
  transport?: TransportSecurityOptions;
}
export async function createApp(options: AppOptions) {
  if (!options.password) throw new Error("APP_PASSWORD 不能为空");
  const workspaces = new Workspaces(
    options.db,
    options.assetDirectory,
    options.credentialSecret,
    options.executionLimits,
  );
  const workflows = await workspaces.initialize();
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 128 * 1024 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
    requestTimeout: 30000,
    ...(options.transport?.https ? { https: options.transport.https } : {}),
    trustProxy: options.transport?.trustedProxies?.length
      ? options.transport.trustedProxies
      : false,
  });
  await app.register(compress, {
    globalDecompression: false,
    encodings: ["br", "gzip"],
    threshold: 1024,
    brotliOptions: { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } },
    zlibOptions: { level: 6 },
    customTypes: (type) =>
      /^(application\/(json|javascript)|text\/(javascript|css|html))(?:;|$)/i.test(
        type,
      ),
  });
  registerTransportSecurity(app, options.transport);
  const accounts = new Accounts(options.db);
  await accounts.initialize(options.password);
  const directory = new WorkspaceDirectory(options.db);
  const auth = registerAuthentication(app, accounts, directory);
  app.decorateRequest("workspace");
  app.addHook("onRequest", async (request) => {
    requestedWorkspaceView(request);
    if (request.user) {
      request.workspace = await workspaces.get(request.user.workspaceId);
    }
  });
  app.addHook("preSerialization", async (request, _reply, payload: any) => {
    if (
      payload?.schema !== 2 ||
      !Array.isArray(payload.products) ||
      !Array.isArray(payload.jobs) ||
      payload.partial
    )
      return payload;
    const view = requestedWorkspaceView(request);
    return view ? presentWorkspace(payload, view) : payload;
  });
  registerMemberRoutes(app, options.db);
  registerWorkspaceRoutes(app, directory);
  registerCollaborationRoutes(app, auth.authenticated);
  await registerAssistant(app, workspaces);
  registerSheetImports(app);
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
  app.get("/api/workflow/settings", (request) =>
    request.workspace.settings(request.user!),
  );
  // Compatibility for already open clients; null explicitly means no cap.
  app.get("/api/execution/limits", () => ({
    prompt: null,
    submit: null,
    query: null,
  }));
  app.delete<{ Params: { id: string } }>(
    "/api/products/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,100}$" },
          },
        },
      },
    },
    (request) =>
      request.workspace.deleteProduct(request.params.id, request.user!),
  );
  const streams = new Set<import("node:http").ServerResponse>();
  app.addHook("preClose", async () => {
    for (const stream of streams) stream.end();
  });
  app.get("/api/analysis/events", async (request, reply) => {
    const workflows = request.workspace;
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    streams.add(reply.raw);
    const send = async (event: any) => {
      if (!(await auth.authenticated(request).catch(() => false)))
        return reply.raw.end();
      if (
        !reply.raw.destroyed &&
        !reply.raw.writableEnded &&
        !reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
      )
        reply.raw.end(); // Reconnection receives the latest snapshot instead of an unbounded backlog.
    };
    workflows.analysisEvents.on("progress", send);
    for (const event of workflows.analysisEvents.latest.values()) send(event);
    const heartbeat = setInterval(async () => {
      if (!(await auth.authenticated(request).catch(() => false)))
        return reply.raw.end();
      if (!reply.raw.destroyed && !reply.raw.writableEnded)
        reply.raw.write(": heartbeat\n\n");
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
      config: { permission: "edit" },
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
    (request) =>
      request.workspace.updateSettings(request.body as any, request.user!),
  );
  app.post(
    "/api/workflow/credentials",
    {
      config: { permission: "manage" },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            apiKey: { type: "string", maxLength: 4096 },
            promptApiKey: { type: "string", maxLength: 4096 },
            clearKey: { type: "boolean" },
            clearPromptKey: { type: "boolean" },
          },
        },
      },
    },
    async (request) => {
      const settings = await request.workspace.updateSettings(
        request.body as any,
        request.user!,
      );
      return { hasKey: settings.hasKey, hasPromptKey: settings.hasPromptKey };
    },
  );
  app.get("/api/workspace/startup", (request) => {
    const repo = request.workspace.repo;
    return repo.db.transaction((tx) =>
      readWorkspace(tx, repo.workspaceId, {
        products: new Set(),
        sheet: false,
      }),
    );
  });
  registerQueueProgress(app);
  app.get<{ Querystring: { ids: string } }>(
    "/api/workspace/products",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["ids"],
          additionalProperties: false,
          properties: { ids: { type: "string", maxLength: 10100 } },
        },
      },
    },
    async (request) => {
      const ids = request.query.ids.split(",");
      if (
        ids.length > 100 ||
        ids.some((id) => !/^[A-Za-z0-9_-]{1,100}$/.test(id))
      )
        throw new AppError("产品加载参数无效");
      const repo = request.workspace.repo;
      const products = (
        await repo.db.query(
          "SELECT document FROM products WHERE workspace_id=$1 AND id IN (SELECT value FROM json_each($2)) ORDER BY code",
          [repo.workspaceId, JSON.stringify(ids)],
        )
      ).rows.map((row) => row.document);
      if (products.length !== new Set(ids).size)
        throw new AppError("产品已不存在，请刷新列表", 404);
      const selected = new Set(ids);
      const jobs = await repo.db.transaction((tx) =>
        readWorkspaceJobs(tx, repo.workspaceId, selected),
      );
      return {
        products,
        jobs: jobs.filter((job) => selected.has(job.productId)),
      };
    },
  );
  app.get("/api/workspace/sheet", async (request) => {
    const repo = request.workspace.repo;
    const row = (
      await repo.db.query(
        "SELECT json_extract(document,'$.sheetSnapshot') AS document FROM workspace WHERE id=$1",
        [repo.workspaceId],
      )
    ).rows[0];
    return { sheetSnapshot: row.document };
  });
  app.get("/api/workspace", (request) => {
    const repo = request.workspace.repo;
    return repo.db.transaction(async (tx) => {
      const view = requestedWorkspaceView(request);
      if (view) return readWorkspace(tx, repo.workspaceId, view);
      await repo.lock(tx);
      return { ...(await repo.view(tx)), syncCursor: await repo.cursor(tx) };
    });
  });
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
    (request) => {
      const repo = request.workspace.repo;
      const view = requestedWorkspaceView(request);
      return repo.db.transaction((tx) =>
        view
          ? readWorkspace(tx, repo.workspaceId, view, request.query.since)
          : repo.changes(tx, request.query.since),
      );
    },
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
              maxItems: 100000,
              items: {
                type: "object",
                required: ["path", "before", "value"],
                additionalProperties: false,
                properties: {
                  path: {
                    type: "array",
                    minItems: 1,
                    maxItems: 12,
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
    (request) => {
      const edits = (request.body as any).edits;
      if (
        request.user?.role !== "owner" &&
        edits.some((edit: any) =>
          ["concurrency", "promptConcurrency", "queryConcurrency"].includes(
            edit.path[0],
          ),
        )
      )
        throw new AppError("仅所有者可修改并发上限", 403);
      return request.workspace.edit(
        edits,
        request.user!,
        request.headers["x-workspace-result"] === "delta",
      );
    },
  );
  app.post(
    "/api/workspace/import",
    {
      config: { permission: "manage" },
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
      return request.workspace.importWorkspace(
        body.commandId,
        body.workspace,
        request.user!,
      );
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
      return request.workspace.repo.history(
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
      return request.workspace.enqueue(
        body.commandId,
        body.pairs,
        body.kind,
        request.user!,
      );
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
      return request.workspace.control(
        (request.params as any).id,
        body.action,
        body,
        request.user!,
      );
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
      return { source: await request.workspace.assets.normalize(source) };
    },
  );
  app.get("/api/assets/:id", async (request, reply) => {
    const asset = await request.workspace.assets.get(
      (request.params as any).id,
    );
    return reply
      .header("Cache-Control", "private, no-store")
      .type(asset.mime)
      .send(asset.bytes);
  });
  app.get("/api/assets/:id/thumbnail", async (request, reply) => {
    const asset = await request.workspace.assets.thumbnail(
      (request.params as any).id,
    );
    return reply
      .header("Cache-Control", "private, no-store")
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
        if (
          extname(filename) === ".html" ||
          basename(filename) === "version.json"
        )
          reply.header("Cache-Control", "no-store");
        else if (
          filename.startsWith(resolve(options.staticDirectory!, "assets")) &&
          /-[\w-]{8}\.[\w]+$/.test(basename(filename))
        )
          reply.header("Cache-Control", "public, max-age=31536000, immutable");
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
  return { app, workflows, workspaces, accounts };
}
