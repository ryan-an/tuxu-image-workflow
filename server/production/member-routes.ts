import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database } from "./types.js";
import { Members } from "./members.js";

export function registerMemberRoutes(app: FastifyInstance, db: Database) {
  const config = { permission: "manage" as const };
  const members = (request: FastifyRequest) =>
    new Members(db, request.user!.workspaceId, request.user!, request.id);
  const properties = {
    displayName: { type: "string", minLength: 1, maxLength: 60 },
    role: { type: "string", enum: ["editor", "viewer"] },
    monthlyLimit: {
      type: ["integer", "null"],
      minimum: 0,
      maximum: 1000000,
    },
  };
  app.get("/api/members", { config }, async (request) => ({
    members: await members(request).list(),
  }));
  app.post<{
    Body: { accountId: string; displayName: string; role: "editor" | "viewer" };
  }>(
    "/api/members/existing",
    {
      config,
      bodyLimit: 2048,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["accountId", "displayName", "role"],
          properties: {
            accountId: { type: "string", minLength: 1, maxLength: 100 },
            displayName: properties.displayName,
            role: properties.role,
          },
        },
      },
    },
    (request) => members(request).addExisting(request.body),
  );
  app.post(
    "/api/members",
    {
      config,
      bodyLimit: 8192,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["username", "displayName", "role", "monthlyLimit"],
          properties: {
            ...properties,
            username: { type: "string", minLength: 3, maxLength: 40 },
            password: { type: "string", minLength: 10, maxLength: 256 },
          },
        },
      },
    },
    (request) =>
      members(request).create(request.body as Parameters<Members["create"]>[0]),
  );
  app.patch<{ Params: { id: string } }>(
    "/api/members/:id",
    {
      config,
      bodyLimit: 8192,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["displayName", "role", "enabled", "monthlyLimit"],
          properties: { ...properties, enabled: { type: "boolean" } },
        },
      },
    },
    async (request) => {
      await members(request).update(
        request.params.id,
        request.body as Parameters<Members["update"]>[1],
      );
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/members/:id/invitation",
    { config },
    (request) => members(request).invite(request.params.id),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/members/:id",
    { config },
    async (request) => {
      await members(request).remove(request.params.id);
      return { ok: true };
    },
  );
  app.get("/api/member-invitations", { config }, async (request) => ({
    invitations: await members(request).invitations(),
  }));
  app.post<{ Body: { role: "editor" | "viewer" } }>(
    "/api/member-invitations",
    {
      config,
      bodyLimit: 1024,
      schema: {
        body: {
          type: "object",
          required: ["role"],
          additionalProperties: false,
          properties: { role: { type: "string", enum: ["editor", "viewer"] } },
        },
      },
    },
    (request) => members(request).invite(undefined, request.body.role),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/member-invitations/:id",
    { config },
    async (request) => {
      await members(request).revoke(request.params.id);
      return { ok: true };
    },
  );
}
