import {
  memberIdentity,
  memberQuery,
  requireOwner,
} from "./workspace-access.js";
import { randomUUID } from "node:crypto";
import type { CurrentUser, WorkspaceMember } from "../../shared/access.js";
import { AppError, type Database, type Queryable } from "./types.js";
import {
  hashPassword,
  validatePassword,
  newToken,
  tokenHash,
} from "./passwords.js";
import { usagePeriod } from "./account-usage.js";
import { assertSystemAdmin, recordAdminAudit } from "./admin.js";

const inviteDuration = 7 * 24 * 3600000;
export function validUsername(raw: string) {
  const name = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(name))
    throw new AppError("用户名须为 3～40 位字母、数字、点、下划线或横线");
  return name;
}
// Membership operations cannot change another person's global credentials.
export class Members {
  constructor(
    public db: Database,
    public readonly workspaceId = "default",
    private actorId?: string | CurrentUser,
    private requestId = "internal",
  ) {}
  private async guard(tx: Queryable) {
    if (this.actorId) await requireOwner(tx, this.workspaceId, this.actorId);
  }
  private async audit(
    tx: Queryable,
    action: string,
    targetAccountId?: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ) {
    if (typeof this.actorId !== "object" || this.actorId.accessMode !== "admin")
      return;
    await recordAdminAudit(tx, {
      actorId: this.actorId.id,
      action,
      workspaceId: this.workspaceId,
      targetAccountId,
      requestId: this.requestId,
      before,
      after,
    });
  }
  async addExisting(input: {
    accountId: string;
    displayName: string;
    role: "editor" | "viewer";
  }) {
    const name = input.displayName.trim();
    if (!name || name.length > 60) throw new AppError("成员名称须为 1～60 字");
    return this.db.transaction(async (tx) => {
      await this.guard(tx);
      if (
        typeof this.actorId !== "object" ||
        this.actorId.accessMode !== "admin"
      )
        throw new AppError("仅超级管理模式可直接添加有效账号", 403);
      await assertSystemAdmin(tx, this.actorId.id);
      const account = (
        await tx.query(
          "SELECT id FROM accounts WHERE id=$1 AND status='active'",
          [input.accountId],
        )
      ).rows[0];
      if (!account) throw new AppError("请选择有效账号", 409);
      const previous = (
        await tx.query(
          "SELECT role,status FROM workspace_members WHERE workspace_id=$1 AND account_id=$2",
          [this.workspaceId, input.accountId],
        )
      ).rows[0];
      if (previous && previous.status !== "deleted")
        throw new AppError("该账号已是本工作区成员", 409);
      const now = Date.now();
      await tx.query(
        "INSERT INTO workspace_members(workspace_id,account_id,display_name,role,status,monthly_limit,created_at,accepted_at) VALUES($1,$2,$3,$4,'active',NULL,$5,$5) ON CONFLICT(workspace_id,account_id) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,status='active',monthly_limit=NULL,created_at=excluded.created_at,accepted_at=excluded.accepted_at",
        [this.workspaceId, input.accountId, name, input.role, now],
      );
      await tx.query(
        "DELETE FROM workspace_invitations WHERE workspace_id=$1 AND account_id=$2",
        [this.workspaceId, input.accountId],
      );
      await this.audit(tx, "member.add", input.accountId, undefined, {
        displayName: name,
        role: input.role,
        status: "active",
      });
      return { id: input.accountId };
    });
  }
  async list(): Promise<WorkspaceMember[]> {
    const period = usagePeriod();
    const rows = (
      await this.db.query(
        `${memberQuery} WHERE m.workspace_id=$1 AND m.status<>'deleted' ORDER BY m.created_at,a.id`,
        [this.workspaceId],
      )
    ).rows;
    // Select usage separately to keep account/member status columns unambiguous.
    const usage = (
      await this.db.query(
        "SELECT account_id,used FROM account_usage WHERE workspace_id=$1 AND period=$2",
        [this.workspaceId, period],
      )
    ).rows;
    const usageByAccount = new Map(
      usage.map((row) => [row.account_id, row.used]),
    );
    return rows.map((row) => ({
      ...memberIdentity(row),
      status: row.member_status,
      accountStatus: row.status,
      acceptedAt: row.accepted_at,
      monthlyLimit: row.monthly_limit,
      used: usageByAccount.get(row.id) || 0,
      period,
      createdAt: row.joined_at,
    }));
  }
  async create(input: {
    username: string;
    displayName: string;
    role: "editor" | "viewer";
    monthlyLimit: number | null;
    password?: string;
  }) {
    const username = validUsername(input.username),
      name = input.displayName.trim();
    if (!name || name.length > 60)
      throw new AppError("请填写 1～60 字的成员名称");
    const hash = input.password
      ? (validatePassword(input.password), await hashPassword(input.password))
      : null;
    const token = newToken(),
      expiresAt = Date.now() + inviteDuration;
    return this.db.transaction(async (tx) => {
      await this.guard(tx);
      let account = (
        await tx.query(
          "SELECT * FROM accounts WHERE username=$1 COLLATE NOCASE",
          [username],
        )
      ).rows[0];
      if (
        account &&
        (hash || account.status === "deleted" || account.status === "disabled")
      )
        throw new AppError("已有账号请通过邀请加入，不能设置或重置其密码", 409);
      if (!account) {
        account = {
          id: randomUUID(),
          username,
          display_name: name,
          password_hash: hash,
          status: hash ? "active" : "pending",
        };
        await tx.query(
          "INSERT INTO accounts(id,username,display_name,status,password_hash,created_at) VALUES($1,$2,$3,$4,$5,$6)",
          [account.id, username, name, account.status, hash, Date.now()],
        );
      }
      const previous = (
        await tx.query(
          "SELECT status FROM workspace_members WHERE workspace_id=$1 AND account_id=$2",
          [this.workspaceId, account.id],
        )
      ).rows[0];
      if (previous && previous.status !== "deleted")
        throw new AppError("该账号已是本工作区成员", 409);
      const active = !!hash;
      await tx.query(
        "INSERT INTO workspace_members(workspace_id,account_id,display_name,role,status,monthly_limit,created_at,accepted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,account_id) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,status=excluded.status,monthly_limit=excluded.monthly_limit,accepted_at=excluded.accepted_at",
        [
          this.workspaceId,
          account.id,
          name,
          input.role,
          active ? "active" : "pending",
          input.monthlyLimit,
          Date.now(),
          active ? Date.now() : null,
        ],
      );
      if (!active)
        await tx.query(
          "INSERT INTO workspace_invitations(id,workspace_id,token_hash,account_id,role,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            this.workspaceId,
            tokenHash(token),
            account.id,
            input.role,
            expiresAt,
            Date.now(),
          ],
        );
      await this.audit(
        tx,
        active ? "member.create" : "invitation.create",
        account.id,
        undefined,
        {
          username,
          displayName: name,
          role: input.role,
          status: active ? "active" : "pending",
        },
      );
      return { id: account.id, ...(active ? {} : { token, expiresAt }) };
    });
  }
  async update(
    id: string,
    input: {
      displayName: string;
      role: "editor" | "viewer";
      enabled: boolean;
      monthlyLimit: number | null;
    },
  ) {
    if (!input.displayName.trim() || input.displayName.trim().length > 60)
      throw new AppError("成员名称须为 1～60 字");
    await this.db.transaction(async (tx) => {
      await this.guard(tx);
      const row = await this.member(tx, id);
      await tx.query(
        "UPDATE workspace_members SET display_name=$3,role=$4,status=$5,monthly_limit=$6 WHERE workspace_id=$1 AND account_id=$2",
        [
          this.workspaceId,
          id,
          input.displayName.trim(),
          input.role,
          input.enabled
            ? row.accepted_at === null || !row.password_hash
              ? "pending"
              : "active"
            : "disabled",
          input.monthlyLimit,
        ],
      );
      if (!input.enabled)
        await tx.query(
          "DELETE FROM workspace_invitations WHERE workspace_id=$1 AND account_id=$2",
          [this.workspaceId, id],
        );
      else
        await tx.query(
          "UPDATE workspace_invitations SET role=$3 WHERE workspace_id=$1 AND account_id=$2",
          [this.workspaceId, id, input.role],
        );
      await this.audit(
        tx,
        "member.update",
        id,
        {
          displayName: row.member_name,
          role: row.role,
          status: row.member_status,
          monthlyLimit: row.monthly_limit,
        },
        {
          displayName: input.displayName.trim(),
          role: input.role,
          enabled: input.enabled,
          monthlyLimit: input.monthlyLimit,
        },
      );
    });
  }
  private async member(tx: Queryable, id: string) {
    const row = (
      await tx.query(
        `${memberQuery} WHERE m.workspace_id=$1 AND a.id=$2 AND m.status<>'deleted'`,
        [this.workspaceId, id],
      )
    ).rows[0];
    if (!row) throw new AppError("成员不存在", 404);
    if (row.role === "owner") throw new AppError("请先转让工作区所有权", 403);
    return row;
  }
  async invite(id?: string, role: "editor" | "viewer" = "editor") {
    const token = newToken(),
      expiresAt = Date.now() + inviteDuration,
      invitationId = randomUUID();
    await this.db.transaction(async (tx) => {
      await this.guard(tx);
      if (id) {
        const row = await this.member(tx, id);
        if (row.status === "disabled" || row.status === "deleted")
          throw new AppError("请先启用账号，再发送邀请", 409);
        if (row.member_status !== "pending")
          throw new AppError(
            "仅待加入成员可以重新邀请；个人密码由本人管理",
            409,
          );
        role = row.role;
        await tx.query(
          "DELETE FROM workspace_invitations WHERE workspace_id=$1 AND account_id=$2",
          [this.workspaceId, id],
        );
      }
      await tx.query(
        "INSERT INTO workspace_invitations(id,workspace_id,token_hash,account_id,role,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          invitationId,
          this.workspaceId,
          tokenHash(token),
          id || null,
          role,
          expiresAt,
          Date.now(),
        ],
      );
      await this.audit(tx, "invitation.create", id, undefined, {
        role,
        expiresAt,
      });
    });
    return { id: invitationId, token, expiresAt };
  }
  async invitations() {
    return (
      await this.db.query(
        "SELECT i.id,i.role,i.expires_at AS expiresAt,a.username FROM workspace_invitations i LEFT JOIN accounts a ON a.id=i.account_id WHERE i.workspace_id=$1 AND i.expires_at>$2 ORDER BY i.created_at DESC",
        [this.workspaceId, Date.now()],
      )
    ).rows;
  }
  async revoke(id: string) {
    await this.db.transaction(async (tx) => {
      await this.guard(tx);
      await tx.query(
        "DELETE FROM workspace_invitations WHERE workspace_id=$1 AND id=$2",
        [this.workspaceId, id],
      );
      await this.audit(tx, "invitation.revoke");
    });
  }
  async remove(id: string) {
    await this.db.transaction(async (tx) => {
      await this.guard(tx);
      const before = await this.member(tx, id);
      await tx.query(
        "UPDATE workspace_members SET status='deleted' WHERE workspace_id=$1 AND account_id=$2",
        [this.workspaceId, id],
      );
      await this.audit(
        tx,
        "member.remove",
        id,
        {
          displayName: before.member_name,
          role: before.role,
          status: before.member_status,
        },
        { status: "deleted" },
      );
      await tx.query(
        "DELETE FROM workspace_invitations WHERE workspace_id=$1 AND account_id=$2",
        [this.workspaceId, id],
      );
    });
  }
}
