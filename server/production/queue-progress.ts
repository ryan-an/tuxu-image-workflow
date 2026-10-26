import type { FastifyInstance } from "fastify";
import { queueProgress } from "../../shared/queue-progress.js";
import { readWorkspace } from "./workspace-loading.js";

export function registerQueueProgress(app: FastifyInstance) {
  app.get<{ Querystring: { page: number; status: string; search: string } }>(
    "/api/queue/products",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            page: { type: "integer", minimum: 1, maximum: 1000000, default: 1 },
            status: {
              type: "string",
              enum: [
                "all",
                "missing",
                "partial",
                "complete",
                "ready",
                "selected",
                "active",
                "attention",
              ],
              default: "all",
            },
            search: { type: "string", maxLength: 500, default: "" },
          },
        },
      },
    },
    (request) => {
      const repo = request.workspace.repo;
      return repo.db.transaction(async (tx) => {
        // SQL projects counts and selected IDs, omitting prompts, histories and
        // the sheet. Only the requested 30 summary rows leave the server.
        const state = await readWorkspace(tx, repo.workspaceId, {
          products: new Set(),
          sheet: false,
        });
        return queueProgress(
          state,
          request.query.page,
          request.query.status,
          request.query.search,
        );
      });
    },
  );
}
