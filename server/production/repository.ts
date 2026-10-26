import { randomUUID } from "node:crypto";
import { JOB_VIEW_COLUMNS, presentJob } from "./workspace-loading.js";
import {
  leaseDuration,
  DEFAULT_EXECUTION_LIMITS,
  type ExecutionLimits,
  type ExecutionLane,
} from "./execution-limits.js";
import {
  executionConcurrency,
  DEFAULT_PROMPT_CONCURRENCY,
  DEFAULT_QUERY_CONCURRENCY,
  CONCURRENCY_FIELDS,
} from "../../shared/execution-settings.js";
import { DEFAULT_CONFIG } from "../../shared/provider-config.js";
import {
  DEFAULT_COMMON,
  migrateDefaultCommon,
} from "../../shared/prompt-suite.js";
import { AppError } from "./types.js";
import type { Database, Queryable, Workspace, Job, Product } from "./types.js";
export const WORKSPACE = "default";
export function emptyWorkspace(): Workspace {
  return {
    schema: 2,
    common: DEFAULT_COMMON,
    promptTemplates: {},
    settings: { ...DEFAULT_CONFIG, mode: "live" },
    concurrency: 2,
    promptConcurrency: DEFAULT_PROMPT_CONCURRENCY,
    queryConcurrency: DEFAULT_QUERY_CONCURRENCY,
    paused: false,
    products: [],
    jobs: [],
    sheetSnapshot: null,
    promptWorkflowVersion: 2,
    autoSizeDefaultsVersion: 1,
    sheetMetadataMergeVersion: 1,
  };
}
export class Repository {
  constructor(
    public db: Database,
    public readonly workspaceId = WORKSPACE,
    public readonly executionLimits: ExecutionLimits = DEFAULT_EXECUTION_LIMITS,
  ) {}
  async history(
    page: number,
    pageSize: number,
    status: string,
    search: string,
  ) {
    return this.db.transaction(async (tx) => {
      const conditions = ["workspace_id=$1"];
      const values: any[] = [this.workspaceId];
      const statuses =
        status === "active"
          ? ["queued", "running"]
          : status === "attention"
            ? ["failed", "interrupted"]
            : status === "all"
              ? []
              : [status];
      if (statuses.length) {
        const slots = statuses.map((value) => {
          values.push(value);
          return `$${values.length}`;
        });
        conditions.push(`status IN (${slots.join(",")})`);
      }
      if (search.trim()) {
        values.push(search.trim());
        conditions.push(
          `instr(lower(COALESCE(json_extract(payload,'$.productName'),'') || ' ' || COALESCE(json_extract(payload,'$.role'),'') || ' ' || COALESCE(remote_id,'') || ' ' || COALESCE(json_extract(payload,'$.error'),'')),lower($${values.length})) > 0`,
        );
      }
      const where = conditions.join(" AND ");
      const total = (
        await tx.query(
          `SELECT count(*) AS total FROM jobs WHERE ${where}`,
          values,
        )
      ).rows[0].total as number;
      const pages = Math.max(1, Math.ceil(total / pageSize));
      page = Math.min(page, pages);
      const rows = await tx.query(
        `SELECT ${JOB_VIEW_COLUMNS} FROM jobs WHERE ${where} ORDER BY COALESCE(json_extract(payload,'$.createdAt'),created_at) DESC,id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, pageSize, (page - 1) * pageSize],
      );
      return {
        jobs: rows.rows.map((row) => presentJob(hydrateJob(row))),
        total,
        page,
        pageSize,
        pages,
      };
    });
  }
  async cursor(tx: Queryable = this.db) {
    return (
      await tx.query(
        "SELECT revision FROM sync_clock WHERE id=1 AND workspace_id=$1",
        [this.workspaceId],
      )
    ).rows[0].revision as number;
  }
  async changes(tx: Queryable, since: number) {
    const cursor = await this.cursor(tx);
    if (since > cursor) return { reset: true, cursor };
    if (since === cursor)
      return {
        cursor,
        products: [],
        jobs: [],
        deletedProducts: [],
        deletedJobs: [],
      };
    const records = (
      await tx.query(
        "SELECT kind,entity_id,deleted FROM sync_entities WHERE revision > $1 AND workspace_id=$2",
        [since, this.workspaceId],
      )
    ).rows;
    const products = (
      await tx.query(
        "SELECT p.document FROM products p JOIN sync_entities s ON s.kind='product' AND s.entity_id=p.id AND s.workspace_id=p.workspace_id WHERE s.revision > $1 AND p.workspace_id=$2 ORDER BY p.code",
        [since, this.workspaceId],
      )
    ).rows.map((p) => p.document);
    const jobs = (
      await tx.query(
        "SELECT j.* FROM jobs j JOIN sync_entities s ON s.kind='job' AND s.entity_id=j.id AND s.workspace_id=j.workspace_id WHERE s.revision > $1 AND j.workspace_id=$2 ORDER BY j.created_at,j.id",
        [since, this.workspaceId],
      )
    ).rows.map(hydrateJob);
    const document = records.some((r) => r.kind === "workspace")
      ? (
          await tx.query("SELECT document FROM workspace WHERE id=$1", [
            this.workspaceId,
          ])
        ).rows[0].document
      : undefined;
    return {
      cursor,
      products,
      jobs,
      document,
      deletedProducts: records
        .filter((r) => r.kind === "product" && r.deleted)
        .map((r) => r.entity_id),
      deletedJobs: records
        .filter((r) => r.kind === "job" && r.deleted)
        .map((r) => r.entity_id),
    };
  }
  async initialize() {
    const { products, jobs, ...document } = emptyWorkspace();
    await this.db.query(
      "INSERT INTO workspace(id,document,created_at) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
      [this.workspaceId, document, Date.now()],
    );
    await this.db.query(
      "UPDATE workspace SET created_at=updated_at WHERE id=$1 AND created_at=0",
      [this.workspaceId],
    );
    await this.db.transaction(async (tx) => {
      const row = await this.lock(tx);
      const common = migrateDefaultCommon(row.document.common);
      if (common !== row.document.common) {
        await this.saveWorkspace(tx, {
          ...row.document,
          common,
          products: [],
          jobs: [],
        });
      }
    });
  }
  async lock(tx: Queryable, includeSheet = true) {
    return (
      await tx.query(
        `SELECT ${includeSheet ? "*" : "id,archived_at,json_remove(document,'$.sheetSnapshot') AS document"} FROM workspace WHERE id=$1`,
        [this.workspaceId],
      )
    ).rows[0];
  }
  async productsById(tx: Queryable, ids: string[]): Promise<Product[]> {
    if (!ids.length) return [];
    return (
      await tx.query(
        "SELECT document FROM products WHERE workspace_id=$1 AND id IN (SELECT value FROM json_each($2)) ORDER BY code",
        [this.workspaceId, JSON.stringify(ids)],
      )
    ).rows.map((row) => row.document);
  }
  async saveWorkspaceFields(tx: Queryable, fields: Record<string, unknown>) {
    const values: any[] = [this.workspaceId];
    const paths = Object.entries(fields).map(([key, value]) => {
      if (
        ![
          "common",
          "promptTemplates",
          ...CONCURRENCY_FIELDS,
          "sheetSnapshot",
        ].includes(key)
      )
        throw new AppError("该字段不能通过编辑接口修改");
      values.push(`$.${key}`, JSON.stringify(value ?? null));
      return `$${values.length - 1},json($${values.length})`;
    });
    if (!paths.length) return;
    await tx.query(
      `UPDATE workspace SET document=json_set(document,${paths.join(",")}),updated_at=$${values.length + 1} WHERE id=$1`,
      [...values, Date.now()],
    );
  }
  async view(tx: Queryable = this.db): Promise<Workspace> {
    const { rows } = await tx.query(
      "SELECT document FROM workspace WHERE id=$1",
      [this.workspaceId],
    );
    const products = await tx.query(
      "SELECT document FROM products WHERE workspace_id=$1 ORDER BY code",
      [this.workspaceId],
    );
    const jobs = await tx.query(
      "SELECT * FROM jobs WHERE workspace_id=$1 ORDER BY created_at,id",
      [this.workspaceId],
    );
    return {
      ...rows[0].document,
      products: products.rows.map((p) => p.document),
      jobs: jobs.rows.map(hydrateJob),
    };
  }
  async saveWorkspace(tx: Queryable, state: Workspace) {
    const { products, jobs, ...document } = state;
    await tx.query(
      "UPDATE workspace SET document=$2,updated_at=$3 WHERE id=$1",
      [this.workspaceId, document, Date.now()],
    );
  }
  async saveProduct(tx: Queryable, product: Product) {
    const result = await tx.query(
      `INSERT INTO products(id,workspace_id,code,document) VALUES($1,$2,$3,$4)
   ON CONFLICT(id) DO UPDATE SET code=excluded.code,document=excluded.document WHERE products.workspace_id=excluded.workspace_id`,
      [product.id, this.workspaceId, product.code, product],
    );
    if (!result.rowCount) throw new AppError("产品 ID 已存在，无法导入", 409);
  }
  async saveJob(tx: Queryable, job: Job, delayMs = 0) {
    await tx.query(
      `UPDATE jobs SET status=$2,stage=$3,remote_id=$4,payload=$5,
   due_at=$6,owner=NULL,lease_until=NULL WHERE id=$1 AND workspace_id=$7`,
      [
        job.id,
        job.status,
        job.stage,
        job.remoteId ?? null,
        job,
        Date.now() + delayMs,
        this.workspaceId,
      ],
    );
  }
  async insertJob(tx: Queryable, job: Job) {
    await tx.query(
      `INSERT INTO jobs(id,workspace_id,product_id,task_id,kind,status,stage,depends_on,remote_id,payload)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        job.id,
        this.workspaceId,
        job.productId,
        job.taskId ?? null,
        job.kind,
        job.status,
        job.stage,
        job.dependsOn ?? null,
        job.remoteId ?? null,
        job,
      ],
    );
  }
  async claim(
    owner: string,
    now = Date.now(),
    lane?: ExecutionLane,
  ): Promise<Job | null> {
    return this.db.transaction(async (tx) => {
      const workspace = (
        await tx.query(
          "SELECT archived_at,json_object('paused',json_extract(document,'$.paused'),'concurrency',json_extract(document,'$.concurrency'),'promptConcurrency',json_extract(document,'$.promptConcurrency'),'queryConcurrency',json_extract(document,'$.queryConcurrency')) AS document FROM workspace WHERE id=$1",
          [this.workspaceId],
        )
      ).rows[0];
      if (workspace.archived_at !== null) return null;
      // An expired paid submission is uncertain. Never resubmit it automatically.
      const expired = (
        await tx.query(
          "SELECT * FROM jobs WHERE status='running' AND lease_until < $1 AND workspace_id=$2",
          [new Date(now), this.workspaceId],
        )
      ).rows;
      for (const row of expired) {
        const job = hydrateJob(row);
        job.status =
          job.remoteId || job.stage === "pending" ? "queued" : "interrupted";
        job.error =
          job.status === "interrupted"
            ? "执行进程中断，平台受理状态未知；请核对平台后处理，禁止盲目重试"
            : "";
        if (job.status === "interrupted") job.finishedAt = now;
        await this.saveJob(tx, job);
        if (job.attemptId)
          await tx.query(
            "UPDATE job_attempts SET outcome='expired',finished_at=$2 WHERE id=$1 AND outcome='running'",
            [job.attemptId, now],
          );
      }
      if (workspace.document.paused) return null;
      const laneSql =
        "CASE WHEN j.kind='prompt-set' THEN 'prompt' WHEN j.remote_id IS NULL THEN 'submit' ELSE 'query' END";
      const counts = (
        await tx.query(
          `SELECT ${laneSql} AS lane,COUNT(*) AS total,SUM(j.workspace_id=$1) AS local FROM jobs j WHERE j.status='running' AND (j.lease_until IS NULL OR j.lease_until>=$2) GROUP BY 1`,
          [this.workspaceId, now],
        )
      ).rows;
      const requested = executionConcurrency(workspace.document);
      const available = (
        ["prompt", "submit", "query"] as ExecutionLane[]
      ).filter((kind) => {
        const count = counts.find((item) => item.lane === kind);
        return (
          (!lane || lane === kind) &&
          (count?.local || 0) < requested[kind] &&
          (count?.total || 0) < this.executionLimits[kind]
        );
      });
      if (!available.length) return null;
      // Resolve failed dependencies with indexed joins, never a full workspace snapshot.
      for (const row of (
        await tx.query(
          "SELECT j.* FROM jobs j LEFT JOIN jobs d ON d.id=j.depends_on AND d.workspace_id=j.workspace_id WHERE j.status='queued' AND j.due_at<=$1 AND j.workspace_id=$2 AND j.depends_on IS NOT NULL AND (d.id IS NULL OR d.status IN ('failed','cancelled','interrupted'))",
          [new Date(now), this.workspaceId],
        )
      ).rows) {
        const job = hydrateJob(row);
        job.status = "failed";
        job.finishedAt = now;
        job.error = "整套提示词未完成，请先处理整套分析任务";
        await this.saveJob(tx, job);
      }
      const memberSql =
        "COALESCE(json_extract(j.payload,'$.createdBy.id'),'legacy')";
      const providerSql =
        "CASE WHEN j.kind='prompt-set' AND json_extract(j.payload,'$.config.promptProvider')='doubao' THEN 'doubao' ELSE 'grsai:'||COALESCE(json_extract(j.payload,'$.config.baseUrl'),'') END";
      const modelSql =
        "CASE WHEN j.kind='prompt-set' THEN json_extract(j.payload,'$.config.promptModel') ELSE json_extract(j.payload,'$.config.imageModel') END";
      const row = (
        await tx.query(
          `SELECT j.* FROM jobs j LEFT JOIN jobs d ON d.id=j.depends_on AND d.workspace_id=j.workspace_id
         LEFT JOIN scheduler_turns t ON t.workspace_id=j.workspace_id AND t.lane=(${laneSql}) AND t.member_id=(${memberSql})
         LEFT JOIN model_cooldowns c ON c.provider=(${providerSql}) AND c.model=(${modelSql})
         WHERE j.workspace_id=$1 AND j.status='queued' AND j.due_at<=$2
           AND (${laneSql}) IN (SELECT value FROM json_each($3))
           AND (j.depends_on IS NULL OR d.status='completed') AND COALESCE(c.retry_until,0)<=$2
         ORDER BY COALESCE(t.sequence,0),j.due_at,j.created_at,j.id LIMIT 1`,
          [this.workspaceId, now, JSON.stringify(available)],
        )
      ).rows[0];
      if (row) {
        const job = hydrateJob(row);
        job.owner = owner;
        job.status = "running";
        job.startedAt ||= now;
        job.attemptId = randomUUID();
        delete job.rateLimitUntil;
        if (job.kind === "prompt-set") {
          job.analysisPhase = "preparing";
          job.timings = { attemptStartedAt: now };
          job.receivedChars = 0;
          job.promptDrafts = {};
        }
        await tx.query(
          `UPDATE jobs SET status='running',owner=$2,lease_until=$3,payload=$4 WHERE id=$1`,
          [job.id, owner, new Date(now + leaseDuration(job.kind)), job],
        );
        await tx.query(
          "INSERT INTO job_attempts(id,job_id,stage,outcome) VALUES($1,$2,$3,'running')",
          [job.attemptId, job.id, job.stage],
        );
        await tx.query(
          `INSERT INTO scheduler_turns(workspace_id,lane,member_id,sequence)
           VALUES($1,$2,$3,(SELECT COALESCE(MAX(sequence),0)+1 FROM scheduler_turns WHERE workspace_id=$1 AND lane=$2))
           ON CONFLICT(workspace_id,lane,member_id) DO UPDATE SET sequence=excluded.sequence`,
          [
            this.workspaceId,
            job.kind === "prompt-set"
              ? "prompt"
              : job.remoteId
                ? "query"
                : "submit",
            job.createdBy?.id || "legacy",
          ],
        );
        return job;
      }
      return null;
    });
  }
  async updateClaim(
    job: Job,
    work: (
      tx: Queryable,
      state: Workspace,
      current: Job,
    ) => Promise<number | void>,
  ) {
    return this.db.transaction(async (tx) => {
      const workspace = await this.lock(tx, false);
      const row = (
        await tx.query("SELECT * FROM jobs WHERE id=$1 AND workspace_id=$2", [
          job.id,
          this.workspaceId,
        ])
      ).rows[0];
      if (
        !row ||
        row.owner !== job.owner ||
        !["running", "cancelled"].includes(row.status) ||
        row.payload.attemptId !== job.attemptId
      )
        return;
      const current = hydrateJob(row);
      const state: Workspace = {
        ...workspace.document,
        products: await this.productsById(tx, [job.productId]),
        jobs: [],
      };
      const delay = await work(tx, state, current);
      await this.saveJob(tx, current, delay || 0);
      await tx.query(
        "UPDATE job_attempts SET outcome=$2,error=$3,finished_at=$4 WHERE id=$1",
        [job.attemptId, current.status, current.error || null, Date.now()],
      );
    });
  }
  async job(id: string, tx: Queryable = this.db): Promise<Job | undefined> {
    const row = (
      await tx.query("SELECT * FROM jobs WHERE id=$1 AND workspace_id=$2", [
        id,
        this.workspaceId,
      ])
    ).rows[0];
    return row ? hydrateJob(row) : undefined;
  }
  async saveAnalysisTiming(job: Job) {
    return this.db.transaction(async (tx) => {
      const current = await this.job(job.id, tx);
      if (
        !current ||
        current.owner !== job.owner ||
        current.attemptId !== job.attemptId ||
        current.status !== "running"
      )
        return false;
      await tx.query(
        "UPDATE jobs SET payload=$2 WHERE id=$1 AND workspace_id=$3",
        [
          job.id,
          {
            ...current,
            timings: job.timings,
            analysisPhase: job.analysisPhase,
          },
          this.workspaceId,
        ],
      );
      return true;
    });
  }
  async deferModel(
    tx: Queryable,
    provider: string,
    model: string,
    until: number,
  ) {
    await tx.query(
      "INSERT INTO model_cooldowns(provider,model,retry_until) VALUES($1,$2,$3) ON CONFLICT(provider,model) DO UPDATE SET retry_until=MAX(retry_until,excluded.retry_until)",
      [provider, model, until],
    );
  }
  async markStage(job: Job, stage: string) {
    return this.db.transaction(async (tx) => {
      await this.lock(tx);
      const row = (
        await tx.query("SELECT * FROM jobs WHERE id=$1 AND workspace_id=$2", [
          job.id,
          this.workspaceId,
        ])
      ).rows[0];
      if (
        !row ||
        row.owner !== job.owner ||
        row.payload.attemptId !== job.attemptId ||
        row.status !== "running"
      )
        return false;
      const current = hydrateJob(row);
      current.stage = stage;
      await tx.query("UPDATE jobs SET stage=$2,payload=$3 WHERE id=$1", [
        job.id,
        stage,
        current,
      ]);
      await tx.query("UPDATE job_attempts SET stage=$2 WHERE id=$1", [
        job.attemptId,
        stage,
      ]);
      job.stage = stage;
      return true;
    });
  }
  async saveAnalysisProgress(
    job: Job,
    drafts: Record<string, string>,
    receivedChars: number,
    analysisResponse?: string,
  ) {
    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query("SELECT * FROM jobs WHERE id=$1 AND workspace_id=$2", [
          job.id,
          this.workspaceId,
        ])
      ).rows[0];
      if (
        !row ||
        row.owner !== job.owner ||
        row.status !== "running" ||
        row.payload.attemptId !== job.attemptId
      )
        return false;
      await tx.query("UPDATE jobs SET payload=$2 WHERE id=$1", [
        job.id,
        {
          ...row.payload,
          promptDrafts: drafts,
          receivedChars,
          ...(analysisResponse !== undefined ? { analysisResponse } : {}),
        },
      ]);
      return true;
    });
  }
}
function hydrateJob(row: any): Job {
  return {
    ...row.payload,
    status: row.status,
    stage: row.stage,
    remoteId: row.remote_id ?? undefined,
    owner: row.owner ?? undefined,
  };
}
