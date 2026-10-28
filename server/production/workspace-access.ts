import { can, type CurrentUser, type Permission } from "../../shared/access.js";
import { AppError, type Queryable } from "./types.js";

export const memberIdentity = (row: any): CurrentUser => ({
  id: row.id,
  username: row.username,
  displayName: row.member_name || row.display_name,
  systemRole: row.system_role || "user",
  workspaceId: row.workspace_id,
  workspaceName: row.workspace_name,
  role: row.role,
  accessMode: row.access_mode || "member",
  archivedAt: row.archived_at,
});
export const memberQuery = `SELECT a.*,m.workspace_id,m.display_name AS member_name,m.role,m.status AS member_status,m.monthly_limit,m.created_at AS joined_at,m.accepted_at,w.name AS workspace_name,w.archived_at FROM workspace_members m JOIN accounts a ON a.id=m.account_id JOIN workspace w ON w.id=m.workspace_id`;

// A mode expresses intent only. Every caller, including write transactions,
// rechecks the current system role rather than trusting client or actor fields.
export async function adminWorkspaceAccess(
  tx: Queryable,
  workspaceId: string,
  accountId: string,
) {
  return (
    await tx.query(
      `SELECT a.*,w.id AS workspace_id,w.name AS workspace_name,w.archived_at,
      m.role AS member_role,m.status AS member_status,m.accepted_at,
      COALESCE(m.role,'viewer') AS role,
      NULL AS monthly_limit,'admin' AS access_mode
      FROM accounts a CROSS JOIN workspace w
      LEFT JOIN workspace_members m ON m.account_id=a.id AND m.workspace_id=w.id
      WHERE a.id=$1 AND a.status='active' AND a.system_role='super_admin' AND w.id=$2`,
      [accountId, workspaceId],
    )
  ).rows[0];
}

// The same authorization facts are used at request entry and inside write transactions.
export async function requireMembership(
  tx: Queryable,
  workspaceId: string,
  account: string | CurrentUser,
  permission?: Permission,
  allowArchived = false,
) {
  const accountId = typeof account === "string" ? account : account.id;
  if (typeof account !== "string" && account.workspaceId !== workspaceId)
    throw new AppError("工作区上下文不匹配", 403);
  if (typeof account !== "string" && account.accessMode === "admin") {
    const admin = await adminWorkspaceAccess(tx, workspaceId, accountId);
    if (!admin || (!allowArchived && admin.archived_at !== null))
      throw new AppError("当前管理身份无权修改此工作区，或工作区已归档", 403);
    return admin;
  }
  const row = (
    await tx.query(
      `${memberQuery} WHERE m.workspace_id=$1 AND a.id=$2 AND a.status='active' AND m.status='active' AND m.accepted_at IS NOT NULL`,
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
  accountId: string | CurrentUser,
  allowArchived = false,
) => requireMembership(tx, workspaceId, accountId, "manage", allowArchived);
