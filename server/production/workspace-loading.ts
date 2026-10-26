import type { FastifyRequest } from "fastify";
import { latestJobs } from "../../shared/job-status.js";
import { AppError, type Job, type Product, type Queryable } from "./types.js";

export interface WorkspaceView {
  products: Set<string> | "all";
  sheet: boolean;
}
export function requestedWorkspaceView(
  request: FastifyRequest,
): WorkspaceView | undefined {
  if (request.headers["x-workspace-view"] !== "compact") return;
  const value = request.headers["x-workspace-products"];
  let products: string[] | "all" = [];
  try {
    products = value === "all" ? "all" : JSON.parse(String(value || "[]"));
  } catch {
    throw new AppError("产品加载参数无效");
  }
  if (
    products !== "all" &&
    (!Array.isArray(products) ||
      products.length > 100 ||
      products.some(
        (id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id),
      ))
  )
    throw new AppError("产品加载参数无效");
  return {
    products: products === "all" ? "all" : new Set(products),
    sheet: request.headers["x-workspace-sheet"] === "1",
  };
}

// Execution snapshots are required by workers and portable backups, but never
// by task lists. Project in SQL so large frozen inputs are not parsed in Node.
const jobPayload = `json_remove(payload,'$.productSnapshot','$.common','$.revisions',
  '$.referenceImages','$.prompt','$.prompts','$.analysisResponse')`;
export const JOB_VIEW_COLUMNS = `id,status,stage,remote_id,created_at,${jobPayload} AS payload`;
export function presentJob(job: Job, details = false) {
  const {
    productSnapshot,
    common,
    revisions,
    referenceImages,
    prompt,
    prompts,
    analysisResponse,
    owner,
    attemptId,
    promptDrafts,
    ...view
  } = job;
  return {
    ...view,
    ...(details &&
    ["running", "queued", "failed", "interrupted"].includes(job.status)
      ? { promptDrafts }
      : {}),
  };
}
function presentJobs(jobs: Job[], products: WorkspaceView["products"]) {
  const selected = latestJobs(jobs) as Job[];
  const ids = new Set(selected.map((job) => job.id));
  for (const job of selected.slice()) {
    const parent = jobs.find((parent) => parent.id === job.dependsOn);
    if (parent && !ids.has(parent.id)) {
      selected.push(parent);
      ids.add(parent.id);
    }
  }
  return selected
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((job) =>
      presentJob(job, products === "all" || products.has(job.productId)),
    );
}
export function summarizeProduct(product: Product) {
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    photo: product.photos?.[0] || product.photo || "",
    _summary: true,
    tasks: product.tasks.map((task) => ({
      id: task.id,
      role: task.role,
      versionCount: task.versions.length,
      primaryId: task.primaryId,
      selectedIds: task.selectedIds,
    })),
  };
}
export function presentWorkspace(state: any, view: WorkspaceView) {
  const { sheetSnapshot, ...document } = state;
  return {
    ...document,
    partial: true,
    sheetLoaded: view.sheet,
    ...(view.sheet ? { sheetSnapshot } : {}),
    products: state.products.map((p: Product) =>
      view.products === "all" || view.products.has(p.id)
        ? p
        : summarizeProduct(p),
    ),
    jobs: presentJobs(state.jobs, view.products),
    jobTotal: state.jobs.length,
  };
}

const productSummary = `json_object(
  'id',p.id,'code',p.code,'name',json_extract(p.document,'$.name'),
  'photo',COALESCE(json_extract(p.document,'$.photos[0]'),json_extract(p.document,'$.photo'),''),
  '_summary',json('true'),
  'tasks',json((SELECT json_group_array(json_object(
    'id',json_extract(t.value,'$.id'),'role',json_extract(t.value,'$.role'),
    'versionCount',COALESCE(json_array_length(t.value,'$.versions'),0),
    'primaryId',json_extract(t.value,'$.primaryId'),
    'selectedIds',json(COALESCE(json_extract(t.value,'$.selectedIds'),'[]'))
  )) FROM json_each(p.document,'$.tasks') t)))`;

export async function readWorkspaceJobs(
  tx: Queryable,
  workspaceId: string,
  products: WorkspaceView["products"],
) {
  const rows = (
    await tx.query(
      `WITH ranked AS (
    SELECT j.id,ROW_NUMBER() OVER (
      PARTITION BY j.product_id,CASE WHEN j.kind='prompt-set' THEN 'prompt' ELSE 'image' END,target.value
      ORDER BY COALESCE(json_extract(j.payload,'$.createdAt'),j.created_at) DESC,j.id DESC
    ) AS position
    FROM jobs j,json_each(CASE WHEN j.kind='prompt-set'
      THEN COALESCE(json_extract(j.payload,'$.taskIds'),json_array(j.id))
      ELSE json_array(COALESCE(json_extract(j.payload,'$.taskId'),j.id)) END) target
    WHERE j.workspace_id=$1
  ), selected AS (
    SELECT id FROM ranked WHERE position=1
    UNION SELECT id FROM jobs WHERE workspace_id=$1 AND status IN ('queued','running','interrupted')
  ), included AS (
    SELECT id FROM selected
    UNION SELECT json_extract(payload,'$.dependsOn') FROM jobs
      WHERE workspace_id=$1 AND id IN (SELECT id FROM selected)
  ) SELECT ${JOB_VIEW_COLUMNS} FROM jobs WHERE workspace_id=$1 AND id IN (SELECT id FROM included)
  ORDER BY created_at,id`,
      [workspaceId],
    )
  ).rows;
  return rows.map((row) =>
    presentJob(
      {
        ...row.payload,
        status: row.status,
        stage: row.stage,
        remoteId: row.remote_id ?? undefined,
      },
      products === "all" || products.has(row.payload.productId),
    ),
  );
}

// Snapshot and cursor are read inside one transaction. Incremental reads retain
// the same scope and never advance a cursor before its product data is applied.
export async function readWorkspace(
  tx: Queryable,
  workspaceId: string,
  view: WorkspaceView,
  since?: number,
) {
  const cursor = (
    await tx.query(
      "SELECT revision FROM sync_clock WHERE id=1 AND workspace_id=$1",
      [workspaceId],
    )
  ).rows[0].revision as number;
  if (since !== undefined && since > cursor) return { reset: true, cursor };
  if (since === cursor)
    return {
      cursor,
      products: [],
      jobs: [],
      deletedProducts: [],
      deletedJobs: [],
    };
  const records =
    since === undefined
      ? []
      : (
          await tx.query(
            "SELECT kind,entity_id,deleted FROM sync_entities WHERE revision > $1 AND workspace_id=$2",
            [since, workspaceId],
          )
        ).rows;
  const row = (
    await tx.query(
      `SELECT ${view.sheet ? "document" : "json_remove(document,'$.sheetSnapshot') AS document"},
    credential IS NOT NULL AS has_key,prompt_credential IS NOT NULL AS has_prompt_key FROM workspace WHERE id=$1`,
      [workspaceId],
    )
  ).rows[0];
  const products = (
    await tx.query(
      `SELECT CASE WHEN $2='all' OR p.id IN (SELECT value FROM json_each($3))
    THEN p.document ELSE ${productSummary} END AS document FROM products p
    WHERE p.workspace_id=$1 AND ($4 IS NULL OR EXISTS (SELECT 1 FROM sync_entities s
      WHERE s.workspace_id=p.workspace_id AND s.kind='product' AND s.entity_id=p.id AND s.revision > $4))
    ORDER BY p.code`,
      [
        workspaceId,
        view.products === "all" ? "all" : "selected",
        JSON.stringify(view.products === "all" ? [] : [...view.products]),
        since ?? null,
      ],
    )
  ).rows.map((row) => row.document);
  const jobs = await readWorkspaceJobs(tx, workspaceId, view.products);
  const jobTotal = (
    await tx.query("SELECT count(*) AS total FROM jobs WHERE workspace_id=$1", [
      workspaceId,
    ])
  ).rows[0].total;
  const document = { ...row.document, partial: true, sheetLoaded: view.sheet };
  if (since === undefined)
    return {
      ...document,
      products,
      jobs,
      jobTotal,
      syncCursor: cursor,
      hasKey: !!row.has_key,
      hasPromptKey: !!row.has_prompt_key,
    };
  return {
    cursor,
    products,
    jobs,
    replaceJobs: true,
    jobTotal,
    ...(records.some((r) => r.kind === "workspace") ? { document } : {}),
    deletedProducts: records
      .filter((r) => r.kind === "product" && r.deleted)
      .map((r) => r.entity_id),
    deletedJobs: records
      .filter((r) => r.kind === "job" && r.deleted)
      .map((r) => r.entity_id),
  };
}
