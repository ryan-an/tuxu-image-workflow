import { can, type CurrentUser, type Permission } from "../../shared/access.js";
import { AppError, type Queryable } from "./types.js";

export const memberIdentity = (row: any): CurrentUser => ({
  id: row.id,
  username: row.username,
  displayName: row.member_name || row.display_name,
  workspaceId: row.workspace_id,
  workspaceName: row.workspace_name,
  role: row.role,
});
export const memberQuery = `SELECT a.*,m.workspace_id,m.display_name AS member_name,m.role,m.status AS member_status,m.monthly_limit,m.created_at AS joined_at,m.accepted_at,w.name AS workspace_name,w.archived_at FROM workspace_members m JOIN accounts a ON a.id=m.account_id JOIN workspace w ON w.id=m.workspace_id`;

// The same authorization facts are used at request entry and inside write transactions.
export async function requireMembership(
  tx: Queryable,
  workspaceId: string,
  accountId: string,
  permission?: Permission,
  allowArchived = false,
) {
  const row = (
    await tx.query(
      `${memberQuery} WHERE m.workspace_id=$1 AND a.id=$2 AND a.status='active' AND m.status='active'`,
      [workspaceId, accountId],
    )
  ).rows[0];
  if (
    !row ||
    (!allowArchived && row.archived_at !== null) ||
    (permission && !can(row.role, permission))
  )
    throw new AppError(
      permission === "manage"
        ? "仅当前工作区所有者可执行此操作"
        : "当前账号不能发起任务或访问此工作区",
      403,
    );
  return row;
}
export const requireOwner = (
  tx: Queryable,
  workspaceId: string,
  accountId: string,
  allowArchived = false,
) => requireMembership(tx, workspaceId, accountId, "manage", allowArchived);
