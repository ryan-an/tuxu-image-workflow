import type { Job, Queryable } from "./types.js";
import { AppError } from "./types.js";
import { requireMembership } from "./workspace-access.js";
import type { CurrentUser } from "../../shared/access.js";

// Calendar months consistently follow the product's China timezone.
export const usagePeriod = (timestamp = Date.now()) =>
  new Date(timestamp + 8 * 3600000).toISOString().slice(0, 7);

// Check after enqueue/retry in its transaction. Active image jobs hold capacity,
// but only successful results become usage; cancellation/failure frees capacity.
export async function assertImageQuota(
  tx: Queryable,
  actor: string | CurrentUser,
  workspaceId: string,
) {
  const accountId = typeof actor === "string" ? actor : actor.id;
  const account = await requireMembership(tx, workspaceId, actor, "edit");
  if (account.access_mode === "admin") return;
  if (account.monthly_limit === null) return;
  const used =
    (
      await tx.query(
        "SELECT used FROM account_usage WHERE account_id=$1 AND period=$2 AND workspace_id=$3",
        [accountId, usagePeriod(), workspaceId],
      )
    ).rows[0]?.used || 0;
  const pending = (
    await tx.query(
      `SELECT COUNT(*) AS count FROM jobs WHERE workspace_id=$1 AND kind='image'
       AND status IN ('queued','running','interrupted')
       AND COALESCE(json_extract(payload,'$.lastRetriedBy.accessMode'),json_extract(payload,'$.createdBy.accessMode'),'member')<>'admin'
       AND COALESCE(json_extract(payload,'$.lastRetriedBy.id'),json_extract(payload,'$.createdBy.id'))=$2`,
      [workspaceId, accountId],
    )
  ).rows[0].count;
  if (used + pending > account.monthly_limit)
    throw new AppError(
      `本月任务额度不足：已成功 ${used}，待完成 ${pending}，上限 ${account.monthly_limit}`,
      403,
    );
}

// Commit once with the downloaded image and completed job in the same transaction.
// Disabled/deleted requesters still own results from their previously queued jobs.
export async function recordImageSuccess(
  tx: Queryable,
  job: Job,
  workspaceId: string,
) {
  const accountId = (job.lastRetriedBy || job.createdBy)?.id;
  if (job.kind !== "image" || job.status !== "completed" || !accountId) return;
  const period = usagePeriod(job.finishedAt);
  if ((job.lastRetriedBy || job.createdBy)?.accessMode === "admin") {
    // Job attribution is frozen at enqueue/retry. A later role change must not
    // move a completed result into a member's quota or erase its historical source.
    const recorded = await tx.query(
      `INSERT INTO admin_image_usage(job_id,account_id,period,workspace_id)
       SELECT $1,id,$3,$4 FROM accounts WHERE id=$2
       AND NOT EXISTS(SELECT 1 FROM account_image_usage WHERE job_id=$1)
       ON CONFLICT(job_id) DO NOTHING`,
      [job.id, accountId, period, workspaceId],
    );
    if (recorded.rowCount)
      await tx.query(
        "INSERT INTO admin_usage(account_id,period,used,workspace_id) VALUES($1,$2,1,$3) ON CONFLICT(workspace_id,account_id,period) DO UPDATE SET used=used+1",
        [accountId, period, workspaceId],
      );
    return;
  }
  const recorded = await tx.query(
    `INSERT INTO account_image_usage(job_id,account_id,period,workspace_id)
     SELECT $1,account_id,$3,workspace_id FROM workspace_members WHERE account_id=$2 AND workspace_id=$4
     AND NOT EXISTS(SELECT 1 FROM admin_image_usage WHERE job_id=$1)
     ON CONFLICT(job_id) DO NOTHING`,
    [job.id, accountId, period, workspaceId],
  );
  if (recorded.rowCount)
    await tx.query(
      "INSERT INTO account_usage(account_id,period,used,workspace_id) VALUES($1,$2,1,$3) ON CONFLICT(workspace_id,account_id,period) DO UPDATE SET used=used+1",
      [accountId, period, workspaceId],
    );
}
