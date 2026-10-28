import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError, type Database } from "./types.js";
import { Admin, type AdminListQuery } from "./admin.js";

export function registerAdminRoutes(app: FastifyInstance, db: Database) {
  // Fastify normally removes additional properties. Reject unknown input before
  // validation so unsupported privilege fields cannot look like accepted edits.
  app.addHook("preValidation", async (request) => {
    if (!request.routeOptions.config.systemAdmin) return;
    const schema = request.routeOptions.schema as
      | {
          body?: { properties?: Record<string, unknown> };
          querystring?: { properties?: Record<string, unknown> };
        }
      | undefined;
    for (const [value, properties] of [
      [request.body, schema?.body?.properties],
      [request.query, schema?.querystring?.properties],
    ] as const) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      if (
        Object.keys(value).some(
          (key) => !properties || !Object.hasOwn(properties, key),
        )
      )
        throw new AppError("请求包含不支持的字段", 400);
    }
  });
  const config = { systemAdmin: true, accountOnly: true };
  const service = (request: FastifyRequest) =>
    new Admin(db, request.account!.id, request.id);
  const text = { type: "string", minLength: 1, maxLength: 60 },
    id = { type: "string", minLength: 1, maxLength: 100 };
  const body = (
    properties: Record<string, object>,
    required = Object.keys(properties),
  ) => ({
    body: { type: "object", additionalProperties: false, required, properties },
  });
  const paging = {
    q: { type: "string", maxLength: 100 },
    page: { type: "integer", minimum: 1, maximum: 1000000, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  };
  app.get<{ Querystring: AdminListQuery }>(
    "/api/admin/accounts",
    {
      config,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...paging,
            status: {
              type: "string",
              enum: ["", "active", "pending", "disabled"],
            },
          },
        },
      },
    },
    (request) => service(request).accounts(request.query),
  );
  app.post<{
    Body: { username: string; displayName: string; password: string };
  }>(
    "/api/admin/accounts",
    {
      config,
      bodyLimit: 8192,
      schema: body({
        username: { type: "string", minLength: 3, maxLength: 40 },
        displayName: text,
        password: { type: "string", minLength: 10, maxLength: 256 },
      }),
    },
    (request) => service(request).createAccount(request.body),
  );
  app.get<{ Params: { id: string } }>(
    "/api/admin/accounts/:id",
    { config },
    (request) => service(request).accountDetail(request.params.id),
  );
  app.delete<{ Params: { id: string }; Body: { username: string } }>(
    "/api/admin/accounts/:id",
    {
      config,
      bodyLimit: 2048,
      schema: body({
        username: { type: "string", minLength: 3, maxLength: 40 },
      }),
    },
    (request) =>
      service(request).deleteAccount(request.params.id, request.body.username),
  );
  app.patch<{ Params: { id: string }; Body: { displayName: string } }>(
    "/api/admin/accounts/:id",
    { config, bodyLimit: 2048, schema: body({ displayName: text }) },
    (request) =>
      service(request).renameAccount(
        request.params.id,
        request.body.displayName,
      ),
  );
  app.post<{ Params: { id: string }; Body: { password: string } }>(
    "/api/admin/accounts/:id/reset-password",
    {
      config,
      bodyLimit: 8192,
      schema: body({
        password: { type: "string", minLength: 10, maxLength: 256 },
      }),
    },
    (request) =>
      service(request).resetPassword(request.params.id, request.body.password),
  );
  app.post<{ Params: { id: string } }>(
    "/api/admin/accounts/:id/revoke-sessions",
    { config, bodyLimit: 1024, schema: body({}) },
    (request) => service(request).revokeSessions(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/api/admin/accounts/:id/disable",
    { config, bodyLimit: 1024, schema: body({}) },
    (request) => service(request).setAccountEnabled(request.params.id, false),
  );
  app.post<{ Params: { id: string } }>(
    "/api/admin/accounts/:id/enable",
    { config, bodyLimit: 1024, schema: body({}) },
    (request) => service(request).setAccountEnabled(request.params.id, true),
  );
  app.get<{ Querystring: AdminListQuery }>(
    "/api/admin/workspaces",
    {
      config,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...paging,
            status: { type: "string", enum: ["", "active", "archived"] },
          },
        },
      },
    },
    (request) => service(request).workspaces(request.query),
  );
  app.post<{ Body: { name: string; ownerId: string } }>(
    "/api/admin/workspaces",
    { config, bodyLimit: 2048, schema: body({ name: text, ownerId: id }) },
    (request) => service(request).createWorkspace(request.body),
  );
  app.get<{ Params: { id: string }; Querystring: { period?: string } }>(
    "/api/admin/workspaces/:id",
    {
      config,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            period: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$" },
          },
        },
      },
    },
    (request) =>
      service(request).workspaceDetail(request.params.id, request.query.period),
  );
  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/api/admin/workspaces/:id",
    { config, bodyLimit: 2048, schema: body({ name: text }) },
    (request) =>
      service(request).renameWorkspace(request.params.id, request.body.name),
  );
  app.post<{ Params: { id: string } }>(
    "/api/admin/workspaces/:id/archive",
    { config, bodyLimit: 1024, schema: body({}) },
    (request) => service(request).archiveWorkspace(request.params.id, true),
  );
  app.post<{ Params: { id: string } }>(
    "/api/admin/workspaces/:id/restore",
    { config, bodyLimit: 1024, schema: body({}) },
    (request) => service(request).archiveWorkspace(request.params.id, false),
  );
  app.post<{ Params: { id: string }; Body: { accountId: string } }>(
    "/api/admin/workspaces/:id/transfer-owner",
    { config, bodyLimit: 1024, schema: body({ accountId: id }) },
    (request) =>
      service(request).transferOwner(request.params.id, request.body.accountId),
  );
  app.post<{ Params: { id: string } }>(
    "/api/admin/workspaces/:id/access",
    { config, bodyLimit: 1024, schema: body({}) },
    (request) => service(request).accessWorkspace(request.params.id),
  );
  app.get<{
    Querystring: AdminListQuery & {
      action?: string;
      from?: string;
      to?: string;
    };
  }>(
    "/api/admin/audit-logs",
    {
      config,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...paging,
            action: { type: "string", maxLength: 120 },
            from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          },
        },
      },
    },
    (request) => service(request).auditLogs(request.query),
  );
}
