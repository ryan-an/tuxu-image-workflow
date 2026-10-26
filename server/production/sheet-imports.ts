import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { importSheetFile } from "../../shared/sheet-file.js";
import {
  detectColumns,
  parseSheet,
  validateSheetParse,
  sheetCell,
  cellText,
} from "../../shared/sheet-data.js";
import {
  applySheetImport,
  sheetImportBaseline,
  sheetImportCounts,
} from "../../shared/sheet-import.js";
import { validateProduct } from "./workflows.js";
import { AppError } from "./types.js";
import { requireMembership } from "./workspace-access.js";
import { recordWorkspaceActivity } from "./workspace-activity.js";

export function registerSheetImports(app: FastifyInstance) {
  app.post<{ Body: { name: string; data: string } }>(
    "/api/workspace/sheet-import/preview",
    {
      bodyLimit: 72 * 1024 * 1024,
      schema: {
        body: {
          type: "object",
          required: ["name", "data"],
          additionalProperties: false,
          properties: {
            name: { type: "string", maxLength: 255 },
            data: { type: "string", maxLength: 70 * 1024 * 1024 },
          },
        },
      },
    },
    async (request) => {
      const workflows = request.workspace;
      const workspaceId = workflows.repo.workspaceId;
      const bytes = Buffer.from(request.body.data, "base64");
      let source: any;
      try {
        source = await importSheetFile({
          name: request.body.name,
          size: bytes.length,
          arrayBuffer: async () => bytes,
        });
      } catch (error) {
        throw new AppError((error as Error).message);
      }
      const mapping = detectColumns(source),
        candidates = parseSheet(source, mapping);
      const issues = validateSheetParse(source, mapping, "auto", candidates);
      if (!candidates.length) issues.push("文件中没有可解析的产品");
      for (const candidate of candidates) {
        if (
          !candidate.sourceRows.some((r: number) =>
            cellText(sheetCell(source, r - 1, mapping.codeColumn)).trim(),
          )
        )
          issues.push(`第${candidate.sourceRows[0]}行缺少产品编号`);
        if (!candidate.name) issues.push(`产品「${candidate.code}」缺少名称`);
      }
      if (issues.length) throw new AppError(issues.join("；"));
      const normalized = await workflows.assets.normalize(candidates);
      const id = randomUUID(),
        expires = Date.now() + 15 * 60 * 1000;
      let counts = { created: 0, updated: 0 };
      await workflows.repo.db.transaction(async (tx) => {
        await workflows.repo.lock(tx);
        await requireMembership(tx, workspaceId, request.user!.id, "edit");
        await tx.query(
          "DELETE FROM sheet_imports WHERE workspace_id=$1 AND expires_at<$2",
          [workspaceId, Date.now()],
        );
        const count = (
          await tx.query(
            "SELECT count(*) AS count FROM sheet_imports WHERE workspace_id=$1 AND json_extract(document,'$.result') IS NULL",
            [workspaceId],
          )
        ).rows[0].count;
        if (Number(count) >= 10)
          throw new AppError("待确认导入过多，请稍后重试", 429);
        const state = await workflows.repo.view(tx);
        counts = sheetImportCounts(state.products, normalized);
        const before = normalized.map((item: any) => {
          const p = state.products.find((p) => p.code === item.code);
          return sheetImportBaseline(p, item);
        });
        await tx.query(
          "INSERT INTO sheet_imports(id,workspace_id,document,expires_at) VALUES($1,$2,$3,$4)",
          [id, workspaceId, { candidates: normalized, before }, expires],
        );
      });
      return {
        importId: id,
        commandId: randomUUID(),
        source: { name: source.name, columnCount: source.columnCount },
        mapping,
        layout: "auto",
        issues: [],
        ...counts,
        total: candidates.length,
        referenceCount: candidates.reduce(
          (n, p) => n + p.tasks.filter((t: any) => t.references.length).length,
          0,
        ),
        candidates: candidates.slice(0, 30).map((p) => ({
          code: p.code,
          name: p.name,
          photos: p.photos.map(() => ""),
          tasks: p.tasks.map((t: any) => ({
            references: t.references.map(() => ""),
            prompt: t.prompt ? "已提供" : "",
            result: t.result ? "已提供" : "",
          })),
        })),
      };
    },
  );
  app.post<{ Params: { id: string }; Body: { commandId: string } }>(
    "/api/workspace/sheet-import/:id/confirm",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["commandId"],
          additionalProperties: false,
          properties: { commandId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request) => {
      const workflows = request.workspace;
      const workspaceId = workflows.repo.workspaceId;
      const result = await workflows.command(
        request.body.commandId,
        { sheetImport: request.params.id },
        async (tx, state) => {
          const staged = (
            await tx.query(
              "SELECT * FROM sheet_imports WHERE id=$1 AND workspace_id=$2",
              [request.params.id, workspaceId],
            )
          ).rows[0];
          if (!staged || staged.expires_at < Date.now())
            throw new AppError("导入确认已过期，请重新选择文件", 409);
          const doc = staged.document;
          if (doc.result) return doc.result;
          for (let i = 0; i < doc.candidates.length; i++) {
            const source = doc.candidates[i],
              current = state.products.find((p) => p.code === source.code);
            if (
              JSON.stringify(sheetImportBaseline(current, source)) !==
              JSON.stringify(doc.before[i])
            )
              throw new AppError(
                `产品「${source.code}」在确认期间已被修改，请重新导入核对`,
                409,
              );
          }
          let imported;
          try {
            imported = applySheetImport(state, doc.candidates, {
              protectDrafts: true,
            });
          } catch (error) {
            throw new AppError((error as Error).message, 409);
          }
          const existingIds = new Set(state.products.map((p) => p.id));
          const changedIds = new Set(imported.updatedIds);
          for (const product of imported.state.products)
            if (!existingIds.has(product.id) || changedIds.has(product.id)) {
              validateProduct(product);
              await workflows.repo.saveProduct(tx, product);
            }
          await workflows.repo.saveWorkspace(tx, imported.state);
          await recordWorkspaceActivity(
            tx,
            workspaceId,
            state,
            imported.state,
            request.user!,
          );
          const result = {
            created: imported.created,
            updated: imported.updated,
            firstProductId: imported.importedIds[0],
            total: imported.importedIds.length,
          };
          await tx.query(
            "UPDATE sheet_imports SET document=$2 WHERE id=$1 AND workspace_id=$3",
            [request.params.id, { result }, workspaceId],
          );
          return result;
        },
        request.user!,
      );
      workflows.collaboration.changed();
      return result;
    },
  );
}
