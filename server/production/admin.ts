import { randomUUID } from "node:crypto";
import { OWNER_ID } from "../../shared/access.js";
import type {
  AdminAccount,
  AdminAccountDetail,
  AdminAccountWorkspace,
  AdminAuditLog,
  AdminPage,
  AdminUsage,
  AdminWorkspace,
  AdminWorkspaceDetail,
} from "../../shared/admin.js";
import { AppError, type Database, type Queryable } from "./types.js";
import { hashPassword, validatePassword } from "./passwords.js";
import { validUsername } from "./members.js";
import { usagePeriod } from "./account-usage.js";
import { emptyWorkspace } from "./repository.js";

export async function assertSystemAdmin(tx: Queryable, actorId: string) {
  const row = (
    await tx.query(
      "SELECT id FROM accounts WHERE id=$1 AND status='active' AND system_role='super_admin'",
      [actorId],
    )
  ).rows[0];
  if (!row) throw new AppError("仅超级管理员可执行此操作", 403);
}

const auditFields = new Set([
  "id",
  "username",
  "displayName",
  "name",
  "status",
  "role",
  "systemRole",
  "enabled",
  "accountId",
  "ownerId",
  "archivedAt",
  "monthlyLimit",
  "hasKey",
  "hasPromptKey",
  "configured",
  "imageModel",
  "imageSize",
  "aspectRatio",
  "gptSize",
  "gptQuality",
  "quality",
  "promptModel",
  "promptProvider",
  "mode",
  "baseUrl",
  "concurrency",
  "promptConcurrency",
  "queryConcurrency",
  "imageProvider",
  "imageNode",
  "promptNode",
  "expiresAt",
  "sessionCount",
  "invitationCount",
  "acceptedAt",
]);
function safeChanges(value?: Record<string, unknown>) {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, item]) =>
          auditFields.has(key) &&
          (item === null ||
            ["string", "number", "boolean"].includes(typeof item)),
      )
      .map(([key, item]) => {
        if (key === "baseUrl" && typeof item === "string") {
          try {
            return [key, new URL(item).origin];
          } catch {
            return [key, "invalid"];
          }
        }
        return [key, typeof item === "string" ? item.slice(0, 256) : item];
      }),
  );
}
export interface AdminAuditInput {
  actorId: string;
  action: string;
  targetAccountId?: string;
  workspaceId?: string;
  requestId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  result?: "success" | "failure";
  errorCode?: string;
}
export async function recordAdminAudit(tx: Queryable, input: AdminAuditInput) {
  await tx.query(
    "INSERT INTO admin_audit_logs(id,created_at,actor_id,action,target_account_id,workspace_id,result,request_id,changes,error_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      randomUUID(),
      Date.now(),
      input.actorId,
      input.action.slice(0, 120),
      input.targetAccountId || null,
      input.workspaceId || null,
      input.result || "success",
      input.requestId,
      JSON.stringify({
        before: safeChanges(input.before),
        after: safeChanges(input.after),
      }),
      input.errorCode || null,
    ],
  );
}
// Derive audit names from known route contracts. Unmatched paths never enter
// the action field, and this mapping never needs credentials or request bodies.
export function adminFailureAction(method: string, route: string): string {
  const pathname = route
    .split("?")[0]
    .replace(/^(\/api\/admin\/(?:accounts|workspaces))\/[^/]+/, "$1/:id")
    .replace(/^(\/api\/members)\/[^/]+/, "$1/:id")
    .replace(/^(\/api\/member-invitations)\/[^/]+/, "$1/:id");
  const actions: Record<string, string> = {
    "POST /api/admin/accounts": "account.create",
    "PATCH /api/admin/accounts/:id": "account.update",
    "DELETE /api/admin/accounts/:id": "account.delete",
    "POST /api/admin/accounts/:id/reset-password": "account.reset-password",
    "POST /api/admin/accounts/:id/revoke-sessions": "account.revoke-sessions",
    "POST /api/admin/accounts/:id/disable": "account.disable",
    "POST /api/admin/accounts/:id/enable": "account.enable",
    "POST /api/admin/workspaces": "workspace.create",
    "PATCH /api/admin/workspaces/:id": "workspace.rename",
    "POST /api/admin/workspaces/:id/archive": "workspace.archive",
    "POST /api/admin/workspaces/:id/restore": "workspace.restore",
    "POST /api/admin/workspaces/:id/transfer-owner": "workspace.transfer-owner",
    "POST /api/admin/workspaces/:id/access": "workspace.access",
    "POST /api/members": "invitation.create",
    "POST /api/members/:id/invitation": "invitation.create",
    "PATCH /api/members/:id": "member.update",
    "DELETE /api/members/:id": "member.remove",
    "POST /api/member-invitations": "invitation.create",
    "DELETE /api/member-invitations/:id": "invitation.revoke",
    "POST /api/workflow/settings": "workspace.settings.update",
    "POST /api/workflow/credentials": "workspace.credentials.update",
  };
  // The literal route must be checked before member ID normalization.
  if (
    method.toUpperCase() === "POST" &&
    route.split("?")[0] === "/api/members/existing"
  )
    return "member.add";
  return actions[`${method.toUpperCase()} ${pathname}`] || "request.failure";
}
export async function recordAdminFailure(
  db: Database,
  actorId: string,
  action: string,
  requestId: string,
  target: {
    targetAccountId?: string;
    workspaceId?: string;
    statusCode?: number;
  } = {},
) {
  await db.transaction(async (tx) => {
    if (
      (
        await tx.query(
          "SELECT id FROM admin_audit_logs WHERE request_id=$1 AND result='failure' LIMIT 1",
          [requestId],
        )
      ).rows.length
    )
      return;
    await recordAdminAudit(tx, {
      actorId,
      action,
      requestId,
      targetAccountId: target.targetAccountId,
      workspaceId: target.workspaceId,
      result: "failure",
      errorCode: `HTTP_${target.statusCode || 500}`,
    });
  });
}

export interface AdminListQuery {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}
const pageBounds = (query: AdminListQuery) => ({
  page: Math.max(1, Math.min(1000000, Number(query.page) || 1)),
  pageSize: Math.max(1, Math.min(100, Number(query.pageSize) || 20)),
});
const accountSelect = `SELECT a.id,a.username,a.display_name AS displayName,a.system_role AS systemRole,a.status,a.created_at AS createdAt,
 (SELECT COUNT(*) FROM workspace_members m WHERE m.account_id=a.id AND m.status<>'deleted') AS workspaceCount,
 (SELECT COUNT(*) FROM workspace_members m WHERE m.account_id=a.id AND m.role='owner' AND m.status<>'deleted') AS ownedWorkspaceCount FROM accounts a`;
const workspaceSelect = `SELECT w.id,w.name,w.created_at AS createdAt,w.archived_at AS archivedAt,a.id AS ownerId,a.username AS ownerUsername,a.display_name AS ownerName,a.status AS ownerStatus,
 (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id=w.id AND m.status<>'deleted') AS memberCount
 FROM workspace w JOIN workspace_members o ON o.workspace_id=w.id AND o.role='owner' JOIN accounts a ON a.id=o.account_id`;
const workspaceIdentity = (row: any): AdminWorkspace => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt,
  archivedAt: row.archivedAt,
  memberCount: row.memberCount,
  owner: {
    id: row.ownerId,
    username: row.ownerUsername,
    displayName: row.ownerName,
    status: row.ownerStatus,
  },
});
function validName(name: string, label = "名称") {
  name = name.trim();
  if (!name || name.length > 60) throw new AppError(`${label}须为 1～60 字`);
  return name;
}

export class Admin {
  constructor(
    public db: Database,
    private actorId: string,
    private requestId: string,
  ) {}
  private audit(
    tx: Queryable,
    action: string,
    target: Omit<AdminAuditInput, "actorId" | "requestId" | "action"> = {},
  ) {
    return recordAdminAudit(tx, {
      ...target,
      actorId: this.actorId,
      requestId: this.requestId,
      action,
    });
  }
  async accounts(query: AdminListQuery = {}): Promise<AdminPage<AdminAccount>> {
    await assertSystemAdmin(this.db, this.actorId);
    const { page, pageSize } = pageBounds(query),
      q = (query.q || "").trim();
    const where =
        "WHERE a.status<>'deleted' AND ($1='' OR instr(lower(a.username||' '||a.display_name),lower($1))>0) AND ($2='' OR a.status=$2)",
      values = [q, query.status || ""];
    const total = (
      await this.db.query(
        `SELECT COUNT(*) AS total FROM accounts a ${where}`,
        values,
      )
    ).rows[0].total;
    const items = (
      await this.db.query(
        `${accountSelect} ${where} ORDER BY a.created_at DESC,a.id LIMIT $3 OFFSET $4`,
        [...values, pageSize, (page - 1) * pageSize],
      )
    ).rows as AdminAccount[];
    return { items, total, page, pageSize };
  }
  private async account(tx: Queryable, id: string): Promise<AdminAccount> {
    const row = (
      await tx.query(`${accountSelect} WHERE a.id=$1 AND a.status<>'deleted'`, [
        id,
      ])
    ).rows[0];
    if (!row) throw new AppError("账号不存在", 404);
    return row;
  }
  async accountDetail(id: string): Promise<AdminAccountDetail> {
    await assertSystemAdmin(this.db, this.actorId);
    const account = await this.account(this.db, id),
      period = usagePeriod();
    const workspaces = (
      await this.db.query(
        `SELECT w.id,w.name,m.role,m.status AS memberStatus,w.archived_at AS archivedAt,COALESCE(u.used,0) AS used FROM workspace_members m JOIN workspace w ON w.id=m.workspace_id LEFT JOIN account_usage u ON u.workspace_id=w.id AND u.account_id=m.account_id AND u.period=$2 WHERE m.account_id=$1 AND m.status<>'deleted' ORDER BY w.created_at,w.id`,
        [id, period],
      )
    ).rows.map((row) => ({ ...row, period })) as AdminAccountWorkspace[];
    return { account, workspaces };
  }
  async createAccount(input: {
    username: string;
    displayName: string;
    password: string;
  }) {
    const username = validUsername(input.username),
      displayName = validName(input.displayName, "个人名称");
    validatePassword(input.password);
    const hash = await hashPassword(input.password),
      id = randomUUID();
    return this.db.transaction(async (tx) => {
      await assertSystemAdmin(tx, this.actorId);
      if (
        (
          await tx.query(
            "SELECT id FROM accounts WHERE username=$1 COLLATE NOCASE",
            [username],
          )
        ).rows.length
      )
        throw new AppError("用户名已存在", 409);
      await tx.query(
        "INSERT INTO accounts(id,username,display_name,status,password_hash,created_at,system_role) VALUES($1,$2,$3,'active',$4,$5,'user')",
        [id, username, displayName, hash, Date.now()],
      );
      await this.audit(tx, "account.create", {
        targetAccountId: id,
        after: { username, displayName, status: "active", systemRole: "user" },
      });
      return { id };
    });
  }
  async renameAccount(id: string, displayName: string) {
    displayName = validName(displayName, "个人名称");
    return this.db.transaction(async (tx) => {
      await assertSystemAdmin(tx, this.actorId);
      const before = await this.account(tx, id);
      await tx.query("UPDATE accounts SET display_name=$2 WHERE id=$1", [
        id,
        displayName,
      ]);
      await this.audit(tx, "account.update", {
        targetAccountId: id,
        before: { displayName: before.displayName },
        after: { displayName },
      });
      return { ok: true };
    });
  }
  async resetPassword(id: string, password: string) {
    validatePassword(password);
    const hash = await hashPassword(password);
    return this.db.transaction(async (tx) => {
      await assertSystemAdmin(tx, this.actorId);
      const account = await this.account(tx, id);
      if (id === OWNER_ID || account.systemRole === "super_admin")
        throw new AppError("默认管理员密码由 APP_PASSWORD 配置管理", 403);
      if (account.status !== "active")
        throw new AppError(
          account.status === "pending"
            ? "待激活账号请通过邀请激活"
            : "请先显式启用账号，再重置密码",
          409,
        );
      await tx.query("UPDATE accounts SET password_hash=$2 WHERE id=$1", [
        id,
        hash,
      ]);
      await tx.query("DELETE FROM account_sessions WHERE account_id=$1", [id]);
      await this.audit(tx, "account.reset-password", { targetAccountId: id });
      return { ok: true };
    });
  }
  async revokeSessions(id: string) {
    return this.db.transaction(async (tx) => {
      await assertSystemAdmin(tx, this.actorId);
      await this.account(tx, id);
      const result = await tx.query(
        "DELETE FROM account_sessions WHERE account_id=$1",
        [id],
      );
      await this.audit(tx, "account.revoke-sessions", {
        targetAccountId: id,
        after: { sessionCount: result.rowCount || 0 },
      });
      return { ok: true };
    });
  }
  async setAccountEnabled(id: string, enabled: boolean) {
    return this.db.transaction(async (tx) => {
      await assertSystemAdmin(tx, this.actorId);
      const account = await this.account(tx, id);
      if (id === OWNER_ID || account.systemRole === "super_admin")
        throw new AppError("不能禁用或改变默认超级管理员账号状态", 403);
      if (account.status === "pending")
        throw new AppError("待激活账号由邀请控制，请在工作区撤销邀请", 409);
      const status = enabled ? "active" : "disabled";
      await tx.query("UPDATE accounts SET status=$2 WHERE id=$1", [id, status]);
      if (!enabled) {
        await tx.query("DELETE FROM account_sessions WHERE account_id=$1", [
          id,
        ]);
        await tx.query(
          "DELETE FROM workspace_invitations WHERE account_id=$1",
          [id],
        );
      }
      await this.audit(tx, enabled ? "account.enable" : "account.disable", {
        targetAccountId: id,
        before: { status: account.status },
        after: { status },
      });
      return { ok: true };
    });
  }
  async deleteAccount(id: string, username: string) {
    return this.db.transaction(async (tx) => {
      await assertSystemAdmin(tx, this.actorId);
      const account = await this.account(tx, id);
      if (id === OWNER_ID || account.systemRole === "super_admin")
        throw new AppError("不能删除默认超级管理员账号", 403);
      if (account.ownedWorkspaceCount)
        throw new AppError("请先转让该账号拥有的全部工作区，再删除账号", 409);
      if (username !== account.username)
        throw new AppError("请输入完整用户名以确认删除", 400);
      // Keep the identity and membership rows for historical attribution. A
      // deleted username stays reserved and cannot be activated or reused.
      await tx.query(
        "UPDATE accounts SET status='deleted',password_hash=NULL WHERE id=$1",
        [id],
      );
      await tx.query("DELETE FROM account_sessions WHERE account_id=$1", [id]);
      await tx.query("DELETE FROM workspace_invitations WHERE account_id=$1", [
        id,
      ]);
      await tx.query(
        "UPDATE workspace_members SET status='deleted' WHERE account_id=$1",
        [id],
      );
      await this.audit(tx, "account.delete", {
        targetAccountId: id,
        before: {
          username: account.username,
          displayName: account.displayName,
          status: account.status,
        },
        after: { status: "deleted" },
      });
      return { ok: true };
    });
  }
  async workspaces(
    query: AdminListQuery = {},
  ): Promise<AdminPage<AdminWorkspace>> {
    await assertSystemAdmin(this.db, this.actorId);
    const { page, pageSize } = pageBounds(query),
      values = [(query.q || "").trim(), query.status || ""];
    const where =
      "WHERE ($1='' OR instr(lower(w.name||' '||w.id||' '||a.username||' '||a.display_name),lower($1))>0) AND ($2='' OR ($2='active' AND w.archived_at IS NULL) OR ($2='archived' AND w.archived_at IS NOT NULL))";
    const total = (
      await this.db.query(
        `SELECT COUNT(*) AS total FROM workspace w JOIN workspace_members o ON o.workspace_id=w.id AND o.role='owner' JOIN accounts a ON a.id=o.account_id ${where}`,
        values,
      )
    ).rows[0].total;
    const items = (
      await this.db.query(
        `${workspaceSelect} ${where} ORDER BY w.created_at DESC,w.id LIMIT $3 OFFSET $4`,
        [...values, pageSize, (page - 1) * pageSize],
      )
    ).rows.map(workspaceIdentity);
    return { items, total, page, pageSize };
  }
  private async workspace(tx: Queryable, id: string): Promise<AdminWorkspace> {
    const row = (await tx.query(`${workspaceSelect} WHERE w.id=$1`, [id]))
      .rows[0];
    if (!row) throw new AppError("工作区不存在", 404);
    return workspaceIdentity(row);
  }
  async workspaceDetail(
    id: string,
    period = usagePeriod(),
  ): Promise<AdminWorkspaceDetail> {
    await assertSystemAdmin(this.db, this.actorId);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
      throw new AppError("月份须为 YYYY-MM");
    const workspace = await this.workspace(this.db, id);
    const rows = (
      await this.db.query(
        `SELECT u.account_id AS accountId,a.username,a.display_name AS displayName,u.used,0 AS administrator FROM account_usage u JOIN accounts a ON a.id=u.account_id WHERE u.workspace_id=$1 AND u.period=$2 UNION ALL SELECT u.account_id AS accountId,a.username,a.display_name AS displayName,u.used,1 AS administrator FROM admin_usage u JOIN accounts a ON a.id=u.account_id WHERE u.workspace_id=$1 AND u.period=$2`,
        [id, period],
      )
    ).rows;
    const members = rows.map((row) => ({
      ...row,
      administrator: !!row.administrator,
    }));
    const usage: AdminUsage = {
      period,
      total: members.reduce((sum, row) => sum + row.used, 0),
      administrator: members
        .filter((row) => row.administrator)
        .reduce((sum, row) => sum + row.used, 0),
      members,
    };
    return { workspace, usage };
  }
  async createWorkspace(input: { name: string; ownerId: string }) {
    const name = validName(input.name, "工作区名称"),
      id = randomUUID(),
      { products, jobs, ...document } = emptyWorkspace();
    return this.db.transaction(async (tx) => {
      await assertSystemAdmin(tx, this.actorId);
      const owner = await this.account(tx, input.ownerId);
      if (owner.status !== "active")
        throw new AppError("所有者必须为有效账号", 409);
      const now = Date.now();
      await tx.query(
        "INSERT INTO workspace(id,name,document,created_at) VALUES($1,$2,$3,$4)",
        [id, name, document, now],
      );
      await tx.query(
        "INSERT INTO workspace_members(workspace_id,account_id,display_name,role,status,created_at,accepted_at) VALUES($1,$2,$3,'owner','active',$4,$4)",
        [id, owner.id, owner.displayName, now],
      );
      await this.audit(tx, "workspace.create", {
        workspaceId: id,
        targetAccountId: owner.id,
        after: { name, ownerId: owner.id },
      });
      return { id };
    });
  }
  async renameWorkspace(id: string, name: string) {
    name = validName(name, "工作区名称");
    return this.db.transaction(async (tx) => {
      await assertSystemAdmin(tx, this.actorId);
      const before = await this.workspace(tx, id);
      await tx.query("UPDATE workspace SET name=$2 WHERE id=$1", [id, name]);
      await this.audit(tx, "workspace.rename", {
        workspaceId: id,
        before: { name: before.name },
        after: { name },
      });
      return { ok: true };
    });
  }
  async archiveWorkspace(id: string, archived: boolean) {
    return this.db.transaction(async (tx) => {
      await assertSystemAdmin(tx, this.actorId);
      const before = await this.workspace(tx, id);
      if (
        archived &&
        (
          await tx.query(
            "SELECT id FROM jobs WHERE workspace_id=$1 AND status IN ('queued','running','interrupted') LIMIT 1",
            [id],
          )
        ).rows.length
      )
        throw new AppError("请先完成或取消工作区内未结束的任务，再归档", 409);
      const archivedAt = archived ? Date.now() : null;
      await tx.query("UPDATE workspace SET archived_at=$2 WHERE id=$1", [
        id,
        archivedAt,
      ]);
      await this.audit(
        tx,
        archived ? "workspace.archive" : "workspace.restore",
        {
          workspaceId: id,
          before: { archivedAt: before.archivedAt },
          after: { archivedAt },
        },
      );
      return { ok: true };
    });
  }
  async transferOwner(id: string, accountId: string) {
    return this.db.transaction(async (tx) => {
      await assertSystemAdmin(tx, this.actorId);
      const workspace = await this.workspace(tx, id);
      if (workspace.archivedAt !== null)
        throw new AppError("请先恢复工作区，再转让所有权", 409);
      if (accountId === workspace.owner.id)
        throw new AppError("请选择其他有效成员", 409);
      const target = (
        await tx.query(
          "SELECT m.account_id FROM workspace_members m JOIN accounts a ON a.id=m.account_id WHERE m.workspace_id=$1 AND m.account_id=$2 AND m.status='active' AND m.accepted_at IS NOT NULL AND a.status='active'",
          [id, accountId],
        )
      ).rows[0];
      if (!target) throw new AppError("只能转让给已加入的有效成员", 400);
      await tx.query(
        "UPDATE workspace_members SET role='editor' WHERE workspace_id=$1 AND role='owner'",
        [id],
      );
      await tx.query(
        "UPDATE workspace_members SET role='owner',monthly_limit=NULL WHERE workspace_id=$1 AND account_id=$2",
        [id, accountId],
      );
      await this.audit(tx, "workspace.transfer-owner", {
        workspaceId: id,
        targetAccountId: accountId,
        before: { ownerId: workspace.owner.id },
        after: { ownerId: accountId },
      });
      return { ok: true };
    });
  }
  async accessWorkspace(id: string) {
    return this.db.transaction(async (tx) => {
      await assertSystemAdmin(tx, this.actorId);
      await this.workspace(tx, id);
      return { url: `/?workspace=${encodeURIComponent(id)}&admin=1` };
    });
  }
  async auditLogs(
    query: AdminListQuery & {
      action?: string;
      from?: string;
      to?: string;
    } = {},
  ): Promise<AdminPage<AdminAuditLog>> {
    await assertSystemAdmin(this.db, this.actorId);
    const { page, pageSize } = pageBounds(query);
    const date = (value: string | undefined, end: boolean) => {
      if (!value) return end ? Number.MAX_SAFE_INTEGER : 0;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new AppError("日期须为 YYYY-MM-DD");
      const stamp = Date.parse(`${value}T00:00:00+08:00`);
      if (
        !Number.isFinite(stamp) ||
        new Date(stamp + 8 * 3600000).toISOString().slice(0, 10) !== value
      )
        throw new AppError("日期无效");
      return stamp + (end ? 86400000 - 1 : 0);
    };
    if (query.from && query.to && query.from > query.to)
      throw new AppError("开始日期不能晚于结束日期");
    const values = [
        (query.q || "").trim(),
        query.action || "",
        date(query.from, false),
        date(query.to, true),
      ],
      where =
        "WHERE ($1='' OR instr(lower(COALESCE(l.target_account_id,'')||' '||COALESCE(t.username,'')||' '||COALESCE(l.workspace_id,'')||' '||COALESCE(w.name,'')),lower($1))>0) AND ($2='' OR l.action=$2) AND l.created_at BETWEEN $3 AND $4";
    const joins =
      "FROM admin_audit_logs l LEFT JOIN accounts a ON a.id=l.actor_id LEFT JOIN accounts t ON t.id=l.target_account_id LEFT JOIN workspace w ON w.id=l.workspace_id";
    const total = (
      await this.db.query(`SELECT COUNT(*) AS total ${joins} ${where}`, values)
    ).rows[0].total;
    const items = (
      await this.db.query(
        `SELECT l.id,l.created_at AS createdAt,l.actor_id AS actorId,COALESCE(a.username,l.actor_id) AS actorUsername,l.action,l.target_account_id AS targetAccountId,t.username AS targetUsername,l.workspace_id AS workspaceId,w.name AS workspaceName,l.result,l.request_id AS requestId,l.error_code AS errorCode,l.changes ${joins} ${where} ORDER BY l.created_at DESC,l.id LIMIT $5 OFFSET $6`,
        [...values, pageSize, (page - 1) * pageSize],
      )
    ).rows.map((row) => ({
      ...row,
      changes: JSON.parse(row.changes),
    })) as AdminAuditLog[];
    return { items, total, page, pageSize };
  }
}
