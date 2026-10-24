import type { FastifyInstance, FastifyRequest } from "fastify";
import { workspaceActivity } from "./workspace-activity.js";

export function registerCollaborationRoutes(
  app: FastifyInstance,
  authenticated: (request: FastifyRequest) => Promise<boolean>,
) {
  const streams = new Set<import("node:http").ServerResponse>();
  app.addHook("preClose", async () => {
    for (const stream of streams) stream.end();
  });
  app.get("/api/workspace/activity", (request) =>
    workspaceActivity(request.workspace.repo.db, request.user!.workspaceId),
  );
  app.post<{ Body: { session: string; selection: any } }>(
    "/api/workspace/presence",
    {
      bodyLimit: 2048,
      schema: {
        body: {
          type: "object",
          required: ["session", "selection"],
          additionalProperties: false,
          properties: {
            session: { type: "string", pattern: "^[a-zA-Z0-9_-]{12,100}$" },
            selection: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "sheetId",
                    "startRow",
                    "endRow",
                    "startColumn",
                    "endColumn",
                  ],
                  properties: {
                    sheetId: { type: "string", minLength: 1, maxLength: 100 },
                    startRow: { type: "integer", minimum: 0, maximum: 1000000 },
                    endRow: { type: "integer", minimum: 0, maximum: 1000000 },
                    startColumn: {
                      type: "integer",
                      minimum: 0,
                      maximum: 16383,
                    },
                    endColumn: { type: "integer", minimum: 0, maximum: 16383 },
                  },
                },
              ],
            },
          },
        },
      },
    },
    (request) => {
      request.workspace.collaboration.update(
        request.body.session,
        request.user!,
        request.body.selection,
      );
      return { ok: true };
    },
  );
  app.get("/api/workspace/events", async (request, reply) => {
    const collaboration = request.workspace.collaboration;
    const requestedSession = new URL(
      request.url,
      "http://localhost",
    ).searchParams.get("session");
    const session =
      requestedSession && /^[a-zA-Z0-9_-]{12,100}$/.test(requestedSession)
        ? requestedSession
        : null;
    if (session) collaboration.connections.set(session, reply.raw);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    streams.add(reply.raw);
    let closed = false;
    // Serialize checks/writes: an old asynchronous authorization check must not
    // reorder invalidations or presence updates on the stream.
    let chain = Promise.resolve();
    const send = (event: any) => {
      chain = chain
        .then(async () => {
          if (closed) return;
          if (!(await authenticated(request))) return void reply.raw.end();
          if (
            !reply.raw.destroyed &&
            !reply.raw.writableEnded &&
            !reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
          )
            reply.raw.end();
        })
        .catch(() => {
          reply.raw.end();
        });
    };
    const heartbeat = setInterval(
      () => send({ type: "presence", peers: collaboration.snapshot() }),
      10000,
    );
    collaboration.on("event", send);
    send({ type: "presence", peers: collaboration.snapshot() });
    // Always reconcile after reconnecting; no assumption that every SSE event arrived.
    send({ type: "changed" });
    reply.raw.once("close", () => {
      closed = true;
      clearInterval(heartbeat);
      streams.delete(reply.raw);
      collaboration.off("event", send);
      if (session && collaboration.connections.get(session) === reply.raw) {
        collaboration.connections.delete(session);
        collaboration.update(session, request.user!, null);
      }
    });
  });
}
