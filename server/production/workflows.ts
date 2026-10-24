import { createHash, randomUUID } from "node:crypto";
import {
  editable,
  applyLatestEdits,
  equal,
} from "../../shared/workspace-edits.js";
import { recordWorkspaceActivity } from "./workspace-activity.js";
import { WorkspaceCollaboration } from "./workspace-collaboration.js";
import { normalizePromptTemplates } from "../../shared/prompt-templates.js";
import type { CurrentUser } from "../../shared/access.js";
import { assertImageQuota } from "./account-usage.js";
import { requireMembership } from "./workspace-access.js";
import type { Permission } from "../../shared/access.js";
import { ROLES, newProduct, savePrompt } from "../../shared/model.js";
import {
  productPhotos,
  productRequirements,
} from "../../shared/prompt-suite.js";
import { baseUrl, MODELS } from "../../shared/provider-config.js";
import { migratePromptSettings } from "../../shared/doubao.js";
import { Repository } from "./repository.js";
import { Credentials } from "./credentials.js";
import { Assets } from "./assets.js";
import { AnalysisEvents } from "./analysis-events.js";
import {
  AppError,
  type Job,
  type Product,
  type Workspace,
  type Queryable,
} from "./types.js";
const active = (j: Job) =>
  ["queued", "running", "interrupted"].includes(j.status);
const configuration = [
  "baseUrl",
  "imageModel",
  "promptProvider",
  "promptModel",
  "aspectRatio",
  "imageSize",
  "gptSize",
  "quality",
];
export function validateProduct(product: Product) {
  if (
    !product ||
    typeof product.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(product.id) ||
    typeof product.code !== "string" ||
    !product.code.trim() ||
    /[<>:"/\\|?*]/.test(product.code) ||
    typeof product.name !== "string" ||
    !product.name.trim() ||
    typeof product.facts !== "string" ||
    (product.promptRequirements != null &&
      (typeof product.promptRequirements !== "string" ||
        !product.promptRequirements.trim() ||
        product.promptRequirements.length > 100000)) ||
    !Array.isArray(product.tasks) ||
    product.tasks.length !== 10 ||
    new Set(product.tasks.map((t) => t.id)).size !== 10 ||
    new Set(product.tasks.map((t) => t.role)).size !== 10
  )
    throw new AppError("产品资料或图片位置不完整");
  for (const t of product.tasks) {
    const reasons: string[] = [];
    const versions = Array.isArray(t.versions) ? t.versions : [];
    const selected = Array.isArray(t.selectedIds) ? t.selectedIds : [];
    if (!Array.isArray(t.versions)) reasons.push("invalid_history");
    if (!Array.isArray(t.selectedIds) || selected.length > 1)
      reasons.push("invalid_selection");
    if (selected.some((id) => !versions.some((version) => version?.id === id)))
      reasons.push("selected_not_in_history");
    if (
      t.primaryId !== null &&
      !versions.some((version) => version?.id === t.primaryId)
    )
      reasons.push("primary_not_in_history");
    if (
      versions.some(
        (version) =>
          !version ||
          typeof version.source !== "string" ||
          !/^\/api\/assets\/[a-f0-9]{64}$/.test(version.source),
      )
    )
      reasons.push("invalid_history_image");
    if (
      typeof t.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(t.id) ||
      !ROLES.includes(t.role) ||
      typeof t.prompt !== "string" ||
      !Array.isArray(t.references) ||
      t.references.some((s) => typeof s !== "string") ||
      !Array.isArray(t.versions) ||
      t.versions.some(
        (v) =>
          !v ||
          typeof v.id !== "string" ||
          !/^[A-Za-z0-9_-]{1,100}$/.test(v.id) ||
          typeof v.source !== "string" ||
          !/^\/api\/assets\/[a-f0-9]{64}$/.test(v.source),
      ) ||
      !Array.isArray(t.promptHistory) ||
      !Array.isArray(t.selectedIds) ||
      t.selectedIds.length > 1 ||
      t.selectedIds.some((id) => !t.versions.some((v) => v.id === id)) ||
      (t.primaryId !== null && !t.versions.some((v) => v.id === t.primaryId))
    )
      throw new AppError(`图片位置、历史或选图关系无效（${t.role}）`, 400, {
        event: "product.validation.failed",
        productId: product.id,
        taskId: t.id,
        role: t.role,
        reasons: reasons.length ? reasons : ["invalid_task_fields"],
        versionCount: versions.length,
        selectedCount: selected.length,
      });
  }
  if (
    typeof product.photo !== "string" ||
    !Array.isArray(product.photos) ||
    product.photos.some((s) => typeof s !== "string")
  )
    throw new AppError("产品图片无效");
}
export class Workflows {
  public analysisEvents = new AnalysisEvents();
  public collaboration = new WorkspaceCollaboration();
  constructor(
    public repo: Repository,
    public assets: Assets,
    private credentials: Credentials,
  ) {}
  async settings() {
    const row = (
      await this.repo.db.query(
        "SELECT document,credential,prompt_credential FROM workspace WHERE id=$1",
        [this.repo.workspaceId],
      )
    ).rows[0];
    return {
      ...row.document.settings,
      mode: "live",
      hasKey: !!row.credential,
      hasPromptKey: !!row.prompt_credential,
    };
  }
  async updateSettings(input: Record<string, any>, actor?: CurrentUser) {
    return this.repo.db.transaction(async (tx) => {
      const row = await this.repo.lock(tx),
        state = await this.repo.view(tx);
      if (row.archived_at !== null) throw new AppError("工作区已归档", 409);
      if (actor)
        await requireMembership(tx, this.repo.workspaceId, actor.id, "manage");
      for (const key of Object.keys(input))
        if (
          ![
            ...configuration,
            "apiKey",
            "clearKey",
            "promptApiKey",
            "clearPromptKey",
            "mode",
          ].includes(key)
        )
          throw new AppError("无效设置字段");
      if (input.mode && input.mode !== "live")
        throw new AppError("生产服务仅支持真实生成");
      for (const key of configuration)
        if (input[key] !== undefined) {
          if (typeof input[key] !== "string" || input[key].length > 200)
            throw new AppError("无效模型设置");
          state.settings[key] = input[key];
        }
      baseUrl(state.settings.baseUrl);
      if (
        !MODELS.includes(state.settings.imageModel) ||
        state.settings.promptProvider !== "doubao" ||
        !state.settings.promptModel?.trim()
      )
        throw new AppError("无效模型");
      const updateKey = (
        current: string | null,
        value: unknown,
        clear: unknown,
      ) => {
        if (
          value !== undefined &&
          (typeof value !== "string" || value.length > 4096)
        )
          throw new AppError("无效密钥");
        const key =
          typeof value === "string"
            ? value
                .trim()
                .replace(/^Bearer\s+/i, "")
                .trim()
            : "";
        return clear ? null : key ? this.credentials.encrypt(key) : current;
      };
      const credential = updateKey(
          row.credential,
          input.apiKey,
          input.clearKey,
        ),
        promptCredential = updateKey(
          row.prompt_credential,
          input.promptApiKey,
          input.clearPromptKey,
        );
      state.settings.mode = "live";
      await this.repo.saveWorkspace(tx, state);
      await tx.query(
        "UPDATE workspace SET credential=$2,prompt_credential=$3 WHERE id=$1",
        [this.repo.workspaceId, credential, promptCredential],
      );
      return {
        ...state.settings,
        hasKey: !!credential,
        hasPromptKey: !!promptCredential,
      };
    });
  }
  async key(provider: "image" | "doubao" = "image") {
    const row = (
      await this.repo.db.query(
        "SELECT credential,prompt_credential FROM workspace WHERE id=$1",
        [this.repo.workspaceId],
      )
    ).rows[0];
    const credential =
      provider === "doubao" ? row.prompt_credential : row.credential;
    if (!credential)
      throw new AppError(
        provider === "doubao"
          ? "请先配置豆包 API Key"
          : "请先配置 Grsai 生图 API Key",
      );
    return this.credentials.decrypt(credential);
  }
  async edit(raw: any[], actor?: CurrentUser) {
    const edits = await this.assets.normalize(raw);
    return this.repo.db
      .transaction(async (tx) => {
        const row = await this.repo.lock(tx);
        if (row.archived_at !== null) throw new AppError("工作区已归档", 409);
        if (actor)
          await requireMembership(
            tx,
            this.repo.workspaceId,
            actor.id,
            raw.some((edit) => edit.path?.[0] === "concurrency")
              ? "manage"
              : "edit",
          );
        const state = await this.repo.view(tx),
          projection = editable(state);
        const before = structuredClone(state);
        for (const e of edits) {
          const path = e.path;
          const allowed =
            Array.isArray(path) &&
            ((path[0] === "sheetSnapshot" &&
              path.length > 1 &&
              path.length <= 12 &&
              path
                .slice(1)
                .every(
                  (part: any) =>
                    typeof part === "string" &&
                    !["__proto__", "constructor", "prototype"].includes(part),
                )) ||
              (path.length === 1 &&
                ["common", "concurrency", "sheetSnapshot"].includes(path[0])) ||
              (path[0] === "promptTemplates" &&
                (path.length === 2 ||
                  (path.length === 3 &&
                    ["name", "content", "updatedAt"].includes(path[2])))) ||
              (path[0] === "products" &&
                path.length === 2 &&
                !projection.products[path[1]]) ||
              (path[0] === "products" &&
                path.length === 3 &&
                [
                  "code",
                  "name",
                  "facts",
                  "promptRequirements",
                  "photo",
                  "photos",
                  "photoThumbnail",
                ].includes(path[2])) ||
              (path[0] === "products" &&
                path.length === 5 &&
                path[2] === "tasks" &&
                [
                  "references",
                  "prompt",
                  "primaryId",
                  "selectedIds",
                  "imports",
                ].includes(path[4])));
          if (!allowed) throw new AppError("该字段不能通过编辑接口修改");
        }
        try {
          applyLatestEdits(projection, edits);
        } catch (error) {
          throw new AppError((error as Error).message, 409);
        }
        try {
          projection.promptTemplates = normalizePromptTemplates(
            projection.promptTemplates,
          );
        } catch (error) {
          throw new AppError((error as Error).message);
        }
        if (
          typeof projection.common !== "string" ||
          projection.common.length > 100000 ||
          !Number.isInteger(projection.concurrency) ||
          projection.concurrency < 1 ||
          projection.concurrency > 6
        )
          throw new AppError("无效规则或并发数量");
        const products: Product[] = [];
        for (const [id, e] of Object.entries(projection.products) as [
          string,
          any,
        ][]) {
          const existing = state.products.find((p) => p.id === id);
          const product: Product =
            existing || newProduct(e.code, e.name, e.facts);
          product.id = id;
          for (const key of [
            "code",
            "name",
            "facts",
            "promptRequirements",
            "photo",
            "photos",
            "photoThumbnail",
          ])
            (product as any)[key] = e[key];
          if (!existing)
            product.tasks = Object.values(e.tasks).map(
              ({ imports, ...t }: any) => ({
                ...t,
                revision: 0,
                promptHistory: [],
                versions: [],
              }),
            );
          else
            for (const task of product.tasks) {
              const input = e.tasks[task.id];
              if (!input || input.role !== task.role)
                throw new AppError("图片位置不能被替换");
              if (input.prompt !== task.prompt) savePrompt(task, input.prompt);
              if (!equal(input.references, task.references)) task.revision++;
              task.references = input.references;
              task.primaryId = input.primaryId;
              task.selectedIds = input.selectedIds;
            }
          for (const task of product.tasks) {
            const imports = e.tasks[task.id].imports || [];
            if (!Array.isArray(imports)) throw new AppError("导入结果格式无效");
            for (const version of imports) {
              if (
                !version ||
                typeof version.id !== "string" ||
                !/^[A-Za-z0-9_-]{1,100}$/.test(version.id) ||
                typeof version.source !== "string" ||
                !/^\/api\/assets\/[a-f0-9]{64}$/.test(version.source) ||
                typeof version.prompt !== "string" ||
                version.prompt.length > 100000 ||
                version.origin !== "imported"
              )
                throw new AppError("导入结果格式无效");
              const existingVersion = task.versions.find(
                (item) => item.id === version.id,
              );
              if (existingVersion) {
                if (
                  existingVersion.source !== version.source ||
                  existingVersion.prompt !== version.prompt ||
                  existingVersion.origin !== "imported"
                )
                  throw new AppError("不能覆盖已有结果历史");
              } else
                task.versions.push({
                  ...version,
                  origin: "imported",
                  number: task.versions.length + 1,
                  createdAt: Date.now(),
                });
            }
          }
          validateProduct(product);
          products.push(product);
        }
        if (new Set(products.map((p) => p.code)).size !== products.length)
          throw new AppError("产品编号重复");
        for (const product of products)
          await this.repo.saveProduct(tx, product);
        state.common = projection.common;
        state.promptTemplates = projection.promptTemplates;
        state.concurrency = projection.concurrency;
        state.sheetSnapshot = projection.sheetSnapshot;
        await recordWorkspaceActivity(
          tx,
          this.repo.workspaceId,
          before,
          state,
          actor,
        );
        await this.repo.saveWorkspace(tx, state);
        return this.repo.view(tx);
      })
      .then((state) => {
        this.collaboration.changed();
        return state;
      });
  }
  async command(
    id: string,
    input: any,
    work: (tx: Queryable, state: Workspace) => Promise<any>,
    actor?: CurrentUser,
    permission: Permission = "edit",
  ) {
    if (typeof id !== "string" || !id || id.length > 100)
      throw new AppError("无效操作 ID");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    return this.repo.db.transaction(async (tx) => {
      const workspace = await this.repo.lock(tx);
      if (workspace.archived_at !== null)
        throw new AppError("工作区已归档", 409);
      if (actor)
        await requireMembership(
          tx,
          this.repo.workspaceId,
          actor.id,
          permission,
        );
      const old = (
        await tx.query(
          "SELECT * FROM commands WHERE id=$1 AND workspace_id=$2",
          [id, this.repo.workspaceId],
        )
      ).rows[0];
      if (old) {
        if (old.fingerprint !== fingerprint)
          throw new AppError("操作 ID 已用于其他请求", 409);
        return old.response;
      }
      const result = await work(tx, await this.repo.view(tx));
      await tx.query(
        "INSERT INTO commands(id,fingerprint,response,workspace_id) VALUES($1,$2,$3,$4)",
        [id, fingerprint, result, this.repo.workspaceId],
      );
      return result;
    });
  }
  async enqueue(
    id: string,
    pairs: { productId: string; taskId: string }[],
    kind: string,
    actor?: CurrentUser,
  ) {
    if (
      !["prompt", "prompt-set", "image", "workflow", "full-workflow"].includes(
        kind,
      ) ||
      !pairs.length ||
      pairs.length > 3000
    )
      throw new AppError("无效任务请求");
    return this.command(
      id,
      { pairs, kind, ...(actor ? { actorId: actor.id } : {}) },
      async (tx, state) => {
        const row = (
          await tx.query(
            "SELECT credential,prompt_credential FROM workspace WHERE id=$1",
            [this.repo.workspaceId],
          )
        ).rows[0];
        if (!["prompt", "prompt-set"].includes(kind) && !row.credential)
          throw new AppError("请先配置 Grsai 生图 API Key");
        const groups = new Map<
          string,
          { product: Product; tasks: Product["tasks"] }
        >();
        for (const pair of pairs) {
          const product = state.products.find((p) => p.id === pair.productId),
            task = product?.tasks.find((t) => t.id === pair.taskId);
          if (!product || !task)
            throw new AppError("任务所属产品或图片位置不存在");
          if (!groups.has(product.id))
            groups.set(product.id, { product, tasks: [] });
          const group = groups.get(product.id)!;
          if (!group.tasks.includes(task)) group.tasks.push(task);
        }
        let count = 0,
          imageCount = 0;
        for (const { product, tasks } of groups.values()) {
          const photos = productPhotos(product);
          if (!photos.length) throw new AppError(`${product.name}：缺少实拍图`);
          const needsSet =
            ["prompt", "prompt-set"].includes(kind) ||
            kind === "full-workflow" ||
            (kind === "workflow" && tasks.some((t) => !t.prompt.trim()));
          const analysisTasks = tasks;
          const activeSets = state.jobs.filter(
            (j) =>
              j.productId === product.id &&
              j.kind === "prompt-set" &&
              ["queued", "running"].includes(j.status),
          );
          let set = needsSet
            ? activeSets.find((j) =>
                analysisTasks.every((t) => j.taskIds?.includes(t.id)),
              )
            : undefined;
          if (
            needsSet &&
            !set &&
            activeSets.some((j) =>
              analysisTasks.some((t) => j.taskIds?.includes(t.id)),
            )
          )
            throw new AppError("所选卡片已有分析任务，请等待完成后重试", 409);
          const fresh = (jobKind: Job["kind"], fields: any): Job => ({
            id: randomUUID(),
            productId: product.id,
            productName: product.name,
            kind: jobKind,
            status: "queued",
            stage: "pending",
            createdAt: Date.now(),
            mode: "live",
            config: { ...state.settings },
            error: "",
            ...(actor
              ? {
                  createdBy: {
                    id: actor.id,
                    username: actor.username,
                    displayName: actor.displayName,
                  },
                }
              : {}),
            ...fields,
          });
          if (needsSet && !set) {
            if (!row.prompt_credential)
              throw new AppError("请先配置豆包 API Key");
            const snapshot = structuredClone(product);
            snapshot.tasks = snapshot.tasks.filter((t) =>
              analysisTasks.some((target) => target.id === t.id),
            );
            snapshot.promptSets = [];
            snapshot.tasks.forEach((t) => {
              t.versions = [];
              t.promptHistory = [];
              t.selectedIds = [];
              t.primaryId = null;
            });
            set = fresh("prompt-set", {
              role:
                analysisTasks.length === 10
                  ? "整套 10 张提示词"
                  : `${analysisTasks.map((t) => t.role).join("、")}提示词`,
              taskIds: analysisTasks.map((t) => t.id),
              productSnapshot: snapshot,
              revisions: Object.fromEntries(
                analysisTasks.map((t) => [t.id, t.revision]),
              ),
              common: productRequirements(product, state.common),
            });
            await this.repo.insertJob(tx, set);
            state.jobs.push(set);
            count++;
          }
          if (["prompt", "prompt-set"].includes(kind)) continue;
          for (const task of tasks) {
            if (state.jobs.some((j) => j.taskId === task.id && active(j)))
              continue;
            if (!set && !task.prompt.trim())
              throw new AppError("请先生成整套提示词");
            const job = fresh("image", {
              taskId: task.id,
              role: task.role,
              prompt: task.prompt,
              dependsOn: needsSet ? set?.id : undefined,
              referenceImages: task.realPhotoIndices?.length
                ? task.realPhotoIndices.map((i) => photos[i]).filter(Boolean)
                : photos,
            });
            await this.repo.insertJob(tx, job);
            state.jobs.push(job);
            count++;
            imageCount++;
          }
        }
        if (actor && imageCount)
          await assertImageQuota(tx, actor.id, this.repo.workspaceId);
        return { count };
      },
      actor,
    );
  }
  async control(
    id: string,
    action: string,
    input: any = {},
    actor?: CurrentUser,
  ) {
    const result = await this.command(
      input.commandId,
      { id, action, ...input, ...(actor ? { actorId: actor.id } : {}) },
      async (tx, state) => {
        if (action === "pause") {
          state.paused = !!input.paused;
          await this.repo.saveWorkspace(tx, state);
          return { ok: true };
        }
        if (
          id === "queue" &&
          ["cancel-pending", "cancel-product"].includes(action)
        ) {
          if (
            action === "cancel-product" &&
            !state.products.some((p) => p.id === input.productId)
          )
            throw new AppError("产品不存在", 404);
          const targets = state.jobs.filter(
            (job) =>
              active(job) &&
              (action === "cancel-product"
                ? job.productId === input.productId
                : job.status === "queued" && !job.remoteId),
          );
          for (const job of targets) {
            job.status = "cancelled";
            job.finishedAt = Date.now();
            job.error =
              job.remoteId || job.stage !== "pending"
                ? "已停止本地执行；平台任务可能仍在运行"
                : "已取消，尚未提交平台";
            // Keep in-flight claims so late submission IDs can still be recorded.
            await tx.query(
              "UPDATE jobs SET status='cancelled',payload=$2 WHERE id=$1",
              [job.id, job],
            );
          }
          return { ok: true, cancelledIds: targets.map((job) => job.id) };
        }
        const job = state.jobs.find((j) => j.id === id);
        if (!job) throw new AppError("任务不存在", 404);
        if (action === "cancel") {
          if (!active(job)) return { ok: true };
          job.status = "cancelled";
          job.finishedAt = Date.now();
          job.error = "已停止本地执行；平台任务可能仍在运行";
          // Preserve an in-flight claim until its submission ID has been recorded.
          await tx.query(
            "UPDATE jobs SET status='cancelled',payload=$2 WHERE id=$1",
            [job.id, job],
          );
          for (const child of state.jobs.filter(
            (child) => child.dependsOn === id && child.status === "queued",
          )) {
            child.status = "cancelled";
            child.error = "上游分析已终止，本任务已取消";
            child.finishedAt = Date.now();
            await this.repo.saveJob(tx, child);
          }
        } else if (action === "retry" || action === "reconcile") {
          const row = (
            await tx.query("SELECT owner,lease_until FROM jobs WHERE id=$1", [
              id,
            ])
          ).rows[0];
          if (row.owner && new Date(row.lease_until).getTime() > Date.now())
            throw new AppError("执行请求尚未结束，请稍后处理", 409);
          if (!["failed", "cancelled", "interrupted"].includes(job.status))
            return { ok: true };
          if (action === "reconcile") {
            if (
              job.kind === "image" &&
              typeof input.remoteId === "string" &&
              input.remoteId.trim()
            )
              job.remoteId = input.remoteId.trim();
            else if (input.confirmNotAccepted !== true)
              throw new AppError("请填写平台任务 ID，或明确确认平台未受理");
            job.stage = job.remoteId ? "polling" : "pending";
          } else if (!job.remoteId && job.stage !== "pending")
            throw new AppError("受理状态未知，需要先核对平台任务", 409);
          if (
            state.jobs.some(
              (j) =>
                j.id !== id &&
                active(j) &&
                j.productId === job.productId &&
                (job.kind === "prompt-set"
                  ? j.kind === "prompt-set" &&
                    j.taskIds?.some((taskId) => job.taskIds?.includes(taskId))
                  : j.taskId === job.taskId),
            )
          )
            throw new AppError("已有相同位置的执行任务", 409);
          let imageJobs = job.kind === "image" ? 1 : 0;
          if (actor)
            job.lastRetriedBy = {
              id: actor.id,
              username: actor.username,
              displayName: actor.displayName,
            };
          job.status = "queued";
          job.error = "";
          delete job.validationError;
          delete job.promptWarnings;
          delete job.analysisResponse;
          delete job.promptDrafts;
          delete job.receivedChars;
          job.failures = 0;
          delete job.finishedAt;
          await this.repo.saveJob(tx, job);
          if (job.kind === "prompt-set")
            for (const child of state.jobs.filter(
              (j) => j.dependsOn === id && j.status === "failed",
            )) {
              if (
                state.jobs.some(
                  (other) =>
                    other.id !== child.id &&
                    other.taskId === child.taskId &&
                    active(other),
                )
              )
                continue;
              child.status = "queued";
              imageJobs++;
              if (actor) child.lastRetriedBy = job.lastRetriedBy;
              child.error = "";
              await this.repo.saveJob(tx, child);
            }
          if (actor && imageJobs)
            await assertImageQuota(tx, actor.id, this.repo.workspaceId);
        } else throw new AppError("无效任务操作");
        return { ok: true };
      },
      actor,
    );
    if ("cancelledIds" in result) {
      for (const jobId of result.cancelledIds as string[]) {
        this.analysisEvents.emit("cancel", jobId);
        this.analysisEvents.publish({
          id: jobId,
          finished: true,
          status: "cancelled",
        });
      }
    }
    if (action === "cancel") {
      // Abort only after the cancellation is committed; the worker's catch must
      // observe cancelled status rather than turn a user cancellation into failure.
      const job = (await this.repo.view()).jobs.find((job) => job.id === id);
      if (job?.status === "cancelled") {
        this.analysisEvents.emit("cancel", id);
        this.analysisEvents.publish({
          id,
          finished: true,
          status: "cancelled",
          error: job.error,
        });
      }
    }
    return result;
  }
  async importWorkspace(id: string, raw: Workspace, actor?: CurrentUser) {
    const imported = await this.assets.normalize(raw);
    return this.command(
      id,
      { import: imported },
      async (tx, state) => {
        if (state.products.length || state.jobs.length)
          throw new AppError("迁移仅允许写入空工作区，已有数据不会被覆盖", 409);
        if (
          imported.schema !== 2 ||
          !Array.isArray(imported.products) ||
          !Array.isArray(imported.jobs)
        )
          throw new AppError("无效工作流备份");
        const taskIds = new Set<string>(),
          productIds = new Set<string>();
        for (const product of imported.products) {
          validateProduct(product);
          if (productIds.has(product.id)) throw new AppError("产品 ID 重复");
          productIds.add(product.id);
          for (const task of product.tasks) {
            if (taskIds.has(task.id)) throw new AppError("图片位置 ID 重复");
            taskIds.add(task.id);
          }
          await this.repo.saveProduct(tx, product);
        }
        state.common =
          typeof imported.common === "string" ? imported.common : state.common;
        try {
          state.promptTemplates = normalizePromptTemplates(
            imported.promptTemplates,
          );
        } catch (error) {
          throw new AppError((error as Error).message);
        }
        state.sheetSnapshot = imported.sheetSnapshot ?? null;
        state.paused = true;
        for (const key of configuration)
          if (typeof imported.settings?.[key] === "string")
            state.settings[key] = imported.settings[key];
        state.settings = migratePromptSettings({
          ...state.settings,
          promptProvider: imported.settings?.promptProvider,
        });
        baseUrl(state.settings.baseUrl);
        state.settings.mode = "live";
        for (const old of imported.jobs) {
          if (
            typeof old.id !== "string" ||
            !/^[A-Za-z0-9_-]{1,100}$/.test(old.id)
          )
            throw new AppError("迁移任务 ID 无效");
          if (
            !productIds.has(old.productId) ||
            !["prompt-set", "image"].includes(old.kind)
          )
            continue;
          const wasActive = ["running", "queued", "interrupted"].includes(
            old.status,
          );
          const job = {
            ...old,
            config: {
              ...Object.fromEntries(
                configuration.map((k) => [
                  k,
                  old.config?.[k] ?? state.settings[k],
                ]),
              ),
              promptProvider:
                old.config?.promptProvider ??
                (old.config?.promptModel
                  ? "grsai"
                  : state.settings.promptProvider),
            },
            mode: "live",
            owner: undefined,
            status: wasActive ? "cancelled" : old.status,
            stage: old.remoteId
              ? "polling"
              : wasActive && old.status !== "queued"
                ? old.kind === "image"
                  ? "submitting"
                  : "analyzing"
                : "pending",
            error: wasActive
              ? "迁移任务已停止，请核对平台后继续查询或重新生成"
              : old.error,
          } as Job;
          job.dependsOn = undefined;
          await this.repo.insertJob(tx, job);
        }
        await this.repo.saveWorkspace(tx, state);
        return { ok: true };
      },
      actor,
      "manage",
    );
  }
}
