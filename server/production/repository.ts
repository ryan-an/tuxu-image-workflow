import { randomUUID } from "node:crypto";
import { leaseDuration } from "./execution-limits.js";
import { DEFAULT_CONFIG } from "../../shared/provider-config.js";
import { DEFAULT_COMMON } from "../../shared/prompt-suite.js";
import type { Database, Queryable, Workspace, Job, Product } from "./types.js";
export const WORKSPACE = "default";
export function emptyWorkspace(): Workspace {
  return {
    schema: 2,
    common: DEFAULT_COMMON,
    settings: { ...DEFAULT_CONFIG, mode: "live" },
    concurrency: 2,
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
  constructor(public db: Database) {}
  async initialize() {
    const { products, jobs, ...document } = emptyWorkspace();
    await this.db.query(
      "INSERT INTO workspace(id,document) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
      [WORKSPACE, document],
    );
  }
  async lock(tx: Queryable) {
    return (await tx.query("SELECT * FROM workspace WHERE id=$1", [WORKSPACE]))
      .rows[0];
  }
  async view(tx: Queryable = this.db): Promise<Workspace> {
    const { rows } = await tx.query(
      "SELECT document FROM workspace WHERE id=$1",
      [WORKSPACE],
    );
    const products = await tx.query(
      "SELECT document FROM products WHERE workspace_id=$1 ORDER BY code",
      [WORKSPACE],
    );
    const jobs = await tx.query(
      "SELECT * FROM jobs WHERE workspace_id=$1 ORDER BY created_at,id",
      [WORKSPACE],
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
      [WORKSPACE, document, Date.now()],
    );
  }
  async saveProduct(tx: Queryable, product: Product) {
    await tx.query(
      `INSERT INTO products(id,workspace_id,code,document) VALUES($1,$2,$3,$4)
   ON CONFLICT(id) DO UPDATE SET code=excluded.code,document=excluded.document`,
      [product.id, WORKSPACE, product.code, product],
    );
  }
  async saveJob(tx: Queryable, job: Job, delayMs = 0) {
    await tx.query(
      `UPDATE jobs SET status=$2,stage=$3,remote_id=$4,payload=$5,
   due_at=$6,owner=NULL,lease_until=NULL WHERE id=$1`,
      [
        job.id,
        job.status,
        job.stage,
        job.remoteId ?? null,
        job,
        Date.now() + delayMs,
      ],
    );
  }
  async insertJob(tx: Queryable, job: Job) {
    await tx.query(
      `INSERT INTO jobs(id,workspace_id,product_id,task_id,kind,status,stage,depends_on,remote_id,payload)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        job.id,
        WORKSPACE,
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
  async claim(owner: string, now = Date.now()): Promise<Job | null> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx);
      // An expired paid submission is uncertain. Never resubmit it automatically.
      const expired = (
        await tx.query(
          "SELECT * FROM jobs WHERE status='running' AND lease_until < $1",
          [new Date(now)],
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
        await this.saveJob(tx, job);
        if (job.attemptId)
          await tx.query(
            "UPDATE job_attempts SET outcome='expired',finished_at=$2 WHERE id=$1 AND outcome='running'",
            [job.attemptId, now],
          );
      }
      const state = await this.view(tx);
      if (
        state.paused ||
        state.jobs.filter((j) => j.status === "running").length >=
          state.concurrency
      )
        return null;
      for (const row of (
        await tx.query(
          "SELECT * FROM jobs WHERE status='queued' AND due_at <= $1 ORDER BY due_at,created_at,id",
          [new Date(now)],
        )
      ).rows) {
        const job = hydrateJob(row),
          dependency = state.jobs.find((j) => j.id === job.dependsOn);
        if (
          job.dependsOn &&
          (!dependency ||
            ["failed", "cancelled", "interrupted"].includes(dependency.status))
        ) {
          job.status = "failed";
          job.error = "整套提示词未完成，请先处理整套分析任务";
          await this.saveJob(tx, job);
          continue;
        }
        if (dependency && dependency.status !== "completed") continue;
        job.owner = owner;
        job.status = "running";
        job.startedAt ||= now;
        job.attemptId = randomUUID();
        await tx.query(
          `UPDATE jobs SET status='running',owner=$2,lease_until=$3,payload=$4 WHERE id=$1`,
          [job.id, owner, new Date(now + leaseDuration(job.kind)), job],
        );
        await tx.query(
          "INSERT INTO job_attempts(id,job_id,stage,outcome) VALUES($1,$2,$3,'running')",
          [job.attemptId, job.id, job.stage],
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
      await this.lock(tx);
      const row = (await tx.query("SELECT * FROM jobs WHERE id=$1", [job.id]))
        .rows[0];
      if (
        !row ||
        row.owner !== job.owner ||
        !["running", "cancelled"].includes(row.status) ||
        row.payload.attemptId !== job.attemptId
      )
        return;
      const current = hydrateJob(row),
        state = await this.view(tx);
      const delay = await work(tx, state, current);
      await this.saveJob(tx, current, delay || 0);
      await tx.query(
        "UPDATE job_attempts SET outcome=$2,error=$3,finished_at=$4 WHERE id=$1",
        [job.attemptId, current.status, current.error || null, Date.now()],
      );
    });
  }
  async markStage(job: Job, stage: string) {
    return this.db.transaction(async (tx) => {
      await this.lock(tx);
      const row = (await tx.query("SELECT * FROM jobs WHERE id=$1", [job.id]))
        .rows[0];
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
  ) {
    return this.db.transaction(async (tx) => {
      const row = (await tx.query("SELECT * FROM jobs WHERE id=$1", [job.id]))
        .rows[0];
      if (
        !row ||
        row.owner !== job.owner ||
        row.status !== "running" ||
        row.payload.attemptId !== job.attemptId
      )
        return false;
      await tx.query("UPDATE jobs SET payload=$2 WHERE id=$1", [
        job.id,
        { ...row.payload, promptDrafts: drafts, receivedChars },
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
