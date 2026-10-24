import type { FastifyInstance } from "fastify";
import type { WorkspaceDirectory } from "./workspace-directory.js";

export function registerWorkspaceRoutes(
  app: FastifyInstance,
  directory: WorkspaceDirectory,
) {
  const config = { accountOnly: true };
  app.get("/api/workspaces", { config }, async (request) => ({
    workspaces: await directory.list(request.account!.id),
  }));
  const nameSchema = {
    body: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: { name: { type: "string", minLength: 1, maxLength: 60 } },
    },
  };
  app.post<{ Body: { name: string } }>(
    "/api/workspaces",
    { config, bodyLimit: 2048, schema: nameSchema },
    (request) => directory.create(request.account!.id, request.body.name),
  );
  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/api/workspaces/:id",
    { config, bodyLimit: 2048, schema: nameSchema },
    async (request) => {
      await directory.rename(
        request.account!.id,
        request.params.id,
        request.body.name,
      );
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string }; Body: { archived: boolean } }>(
    "/api/workspaces/:id/archive",
    {
      config,
      bodyLimit: 1024,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["archived"],
          properties: { archived: { type: "boolean" } },
        },
      },
    },
    async (request) => {
      await directory.archive(
        request.account!.id,
        request.params.id,
        request.body.archived,
      );
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/workspaces/:id/leave",
    { config, bodyLimit: 1024 },
    async (request) => {
      await directory.leave(request.account!.id, request.params.id);
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string }; Body: { accountId: string } }>(
    "/api/workspaces/:id/transfer",
    {
      config,
      bodyLimit: 1024,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["accountId"],
          properties: {
            accountId: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (request) => {
      await directory.transfer(
        request.account!.id,
        request.params.id,
        request.body.accountId,
      );
      return { ok: true };
    },
  );
}
