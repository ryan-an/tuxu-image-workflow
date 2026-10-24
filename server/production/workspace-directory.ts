import { randomUUID } from "node:crypto";
import type { CurrentUser, WorkspaceSummary } from "../../shared/access.js";
import { AppError, type Database } from "./types.js";
import { emptyWorkspace } from "./repository.js";
import {
  memberIdentity,
  memberQuery,
  requireOwner,
} from "./workspace-access.js";

// Workspace lifecycle and membership access; business runtimes stay in Workspaces.
export class WorkspaceDirectory {
  constructor(public db: Database) {}
  async list(accountId: string): Promise<WorkspaceSummary[]> {
    return (
      await this.db.query(
        `SELECT w.id,w.name,m.role,w.created_at AS createdAt,w.archived_at AS archivedAt,
      (SELECT COUNT(*) FROM workspace_members c WHERE c.workspace_id=w.id AND c.status<>'deleted') AS memberCount
      FROM workspace w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.account_id=$1 AND m.status='active'
      AND (w.archived_at IS NULL OR m.role='owner') ORDER BY w.created_at,w.id`,
        [accountId],
      )
    ).rows;
  }
  async context(
    accountId: string,
    workspaceId?: string,
  ): Promise<CurrentUser | null> {
    const row = (
      await this.db.query(
        `${memberQuery} WHERE a.id=$1 AND a.status='active' AND m.status='active' AND w.archived_at IS NULL ${workspaceId ? "AND m.workspace_id=$2" : ""} ORDER BY CASE WHEN m.workspace_id='default' THEN 0 ELSE 1 END,m.created_at,m.workspace_id LIMIT 1`,
        workspaceId ? [accountId, workspaceId] : [accountId],
      )
    ).rows[0];
    return row ? memberIdentity(row) : null;
  }
  async create(accountId: string, name: string) {
    name = name.trim();
    if (!name || name.length > 60)
      throw new AppError("工作区名称须为 1～60 字");
    const id = randomUUID(),
      { products, jobs, ...document } = emptyWorkspace();
    await this.db.transaction(async (tx) => {
      const account = (
        await tx.query(
          "SELECT * FROM accounts WHERE id=$1 AND status='active'",
          [accountId],
        )
      ).rows[0];
      if (!account) throw new AppError("账号已失效，请重新登录", 401);
      await tx.query(
        "INSERT INTO workspace(id,name,document,created_at) VALUES($1,$2,$3,$4)",
        [id, name, document, Date.now()],
      );
      await tx.query(
        "INSERT INTO workspace_members(workspace_id,account_id,display_name,role,status,created_at,accepted_at) VALUES($1,$2,$3,'owner','active',$4,$4)",
        [id, accountId, account.display_name, Date.now()],
      );
    });
    return { id };
  }
  async rename(accountId: string, id: string, name: string) {
    name = name.trim();
    if (!name || name.length > 60)
      throw new AppError("工作区名称须为 1～60 字");
    await this.db.transaction(async (tx) => {
      await requireOwner(tx, id, accountId, true);
      await tx.query("UPDATE workspace SET name=$2 WHERE id=$1", [id, name]);
    });
  }
  async archive(accountId: string, id: string, archived: boolean) {
    await this.db.transaction(async (tx) => {
      await requireOwner(tx, id, accountId, true);
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
      await tx.query("UPDATE workspace SET archived_at=$2 WHERE id=$1", [
        id,
        archived ? Date.now() : null,
      ]);
    });
  }
  async leave(accountId: string, id: string) {
    await this.db.transaction(async (tx) => {
      const member = (
        await tx.query(
          "SELECT role FROM workspace_members WHERE workspace_id=$1 AND account_id=$2 AND status<>'deleted'",
          [id, accountId],
        )
      ).rows[0];
      if (!member) throw new AppError("你不是此工作区成员", 404);
      if (member.role === "owner")
        throw new AppError("请先转让所有权，再退出工作区", 409);
      await tx.query(
        "UPDATE workspace_members SET status='deleted' WHERE workspace_id=$1 AND account_id=$2",
        [id, accountId],
      );
      await tx.query(
        "DELETE FROM workspace_invitations WHERE workspace_id=$1 AND account_id=$2",
        [id, accountId],
      );
    });
  }
  async transfer(accountId: string, id: string, targetId: string) {
    await this.db.transaction(async (tx) => {
      await requireOwner(tx, id, accountId);
      if (accountId === targetId) throw new AppError("请选择其他成员");
      const target = (
        await tx.query(
          "SELECT m.account_id FROM workspace_members m JOIN accounts a ON a.id=m.account_id WHERE m.workspace_id=$1 AND m.account_id=$2 AND m.status='active' AND a.status='active'",
          [id, targetId],
        )
      ).rows[0];
      if (!target) throw new AppError("只能转让给已加入的有效成员", 400);
      await tx.query(
        "UPDATE workspace_members SET role='editor' WHERE workspace_id=$1 AND account_id=$2",
        [id, accountId],
      );
      await tx.query(
        "UPDATE workspace_members SET role='owner',monthly_limit=NULL WHERE workspace_id=$1 AND account_id=$2",
        [id, targetId],
      );
    });
  }
}
