import { randomUUID } from "node:crypto";
import type { UserIdentity, WorkspaceInvitation } from "../../shared/access.js";
import { AppError, type Database, type Queryable } from "./types.js";
import { hashPassword, validatePassword, tokenHash } from "./passwords.js";
import { accountIdentity } from "./accounts.js";
import { validUsername } from "./members.js";

export class Invitations {
  constructor(private db: Database) {}
  private async find(tx: Queryable, token: string) {
    const row = (
      await tx.query(
        `SELECT i.*,w.name AS workspace_name,a.username,a.display_name,a.status AS account_status,a.password_hash
      FROM workspace_invitations i JOIN workspace w ON w.id=i.workspace_id LEFT JOIN accounts a ON a.id=i.account_id
      WHERE i.token_hash=$1 AND i.expires_at>$2 AND w.archived_at IS NULL`,
        [tokenHash(token), Date.now()],
      )
    ).rows[0];
    if (!row) throw new AppError("邀请链接已失效，请联系所有者重新生成", 410);
    return row;
  }
  async inspect(token: string): Promise<WorkspaceInvitation> {
    const row = await this.find(this.db, token);
    return {
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      role: row.role,
      requiresLogin: !!row.password_hash,
      ...(row.account_id
        ? {
            accountId: row.account_id,
            username: row.username,
            displayName: row.display_name,
          }
        : {}),
    };
  }
  async accept(
    token: string,
    input: { username?: string; displayName?: string; password?: string },
    actor: UserIdentity | null,
  ) {
    const info = await this.find(this.db, token);
    // A targeted activation must set its own password, even if another user is signed in.
    const activation = !!info.account_id && !info.password_hash;
    const registering = activation || !actor;
    if (!activation && info.account_id && !actor)
      throw new AppError("请登录已有账号后加入工作区", 401);
    const hash = registering
      ? (validatePassword(input.password || ""),
        await hashPassword(input.password!))
      : null;
    return this.db.transaction(async (tx) => {
      const row = await this.find(tx, token);
      let account: any;
      if (activation) {
        account = (
          await tx.query(
            "SELECT * FROM accounts WHERE id=$1 AND status='pending' AND password_hash IS NULL",
            [row.account_id],
          )
        ).rows[0];
        if (!account) throw new AppError("账号已激活，请登录后加入", 409);
        await tx.query(
          "UPDATE accounts SET password_hash=$2,status='active' WHERE id=$1",
          [account.id, hash],
        );
        account.password_hash = hash;
      } else if (actor) {
        account = (
          await tx.query(
            "SELECT * FROM accounts WHERE id=$1 AND status='active'",
            [actor.id],
          )
        ).rows[0];
        if (!account || (row.account_id && row.account_id !== actor.id))
          throw new AppError("请使用受邀账号登录", 403);
      } else {
        const username = validUsername(input.username || ""),
          displayName = input.displayName?.trim() || username;
        if (displayName.length > 60) throw new AppError("名称最多 60 字");
        if (
          (
            await tx.query(
              "SELECT id FROM accounts WHERE username=$1 COLLATE NOCASE",
              [username],
            )
          ).rows.length
        )
          throw new AppError("用户名已存在，请登录后加入", 409);
        account = {
          id: randomUUID(),
          username,
          display_name: displayName,
          password_hash: hash,
        };
        await tx.query(
          "INSERT INTO accounts(id,username,display_name,status,password_hash,created_at) VALUES($1,$2,$3,'active',$4,$5)",
          [account.id, username, displayName, hash, Date.now()],
        );
      }
      const previous = (
        await tx.query(
          "SELECT * FROM workspace_members WHERE workspace_id=$1 AND account_id=$2",
          [row.workspace_id, account.id],
        )
      ).rows[0];
      if (previous?.status === "active")
        throw new AppError("你已加入这个工作区", 409);
      if (previous?.status === "disabled")
        throw new AppError("你的成员身份已被禁用，请联系所有者重新启用", 403);
      await tx.query(
        "INSERT INTO workspace_members(workspace_id,account_id,display_name,role,status,created_at,accepted_at) VALUES($1,$2,$3,$4,'active',$5,$5) ON CONFLICT(workspace_id,account_id) DO UPDATE SET role=excluded.role,status='active',accepted_at=excluded.accepted_at",
        [
          row.workspace_id,
          account.id,
          account.display_name,
          row.role,
          Date.now(),
        ],
      );
      await tx.query("DELETE FROM workspace_invitations WHERE id=$1", [row.id]);
      return {
        user: accountIdentity(account),
        passwordHash: account.password_hash as string,
        workspaceId: row.workspace_id,
      };
    });
  }
}
