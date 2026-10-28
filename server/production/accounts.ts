import { randomUUID } from "node:crypto";
import type { UserIdentity } from "../../shared/access.js";
import { OWNER_ID, OWNER_USERNAME } from "../../shared/access.js";
import { AppError, type Database } from "./types.js";
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  newToken,
  tokenHash,
} from "./passwords.js";

export const sessionDuration = 12 * 3600000;
export const accountIdentity = (row: any): UserIdentity => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  systemRole: row.system_role || "user",
});

// Global identity and credentials only. Workspace roles live in workspace_members.
export class Accounts {
  private dummyHash = "";
  constructor(public db: Database) {}
  async initialize(ownerPassword: string) {
    const existing = (
      await this.db.query("SELECT * FROM accounts WHERE id=$1", [OWNER_ID])
    ).rows[0];
    if (
      !existing ||
      !(await verifyPassword(ownerPassword, existing.password_hash))
    ) {
      const hash = await hashPassword(ownerPassword);
      await this.db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO accounts(id,username,display_name,status,password_hash,created_at,system_role) VALUES($1,$2,'所有者','active',$3,$4,'super_admin') ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash",
          [OWNER_ID, OWNER_USERNAME, hash, Date.now()],
        );
        if (!existing)
          await tx.query(
            "INSERT INTO workspace_members(workspace_id,account_id,display_name,role,status,created_at,accepted_at) VALUES('default',$1,'所有者','owner','active',$2,$2)",
            [OWNER_ID, Date.now()],
          );
        await tx.query("DELETE FROM account_sessions WHERE account_id=$1", [
          OWNER_ID,
        ]);
      });
    }
    this.dummyHash = (
      await this.db.query("SELECT password_hash FROM accounts WHERE id=$1", [
        OWNER_ID,
      ])
    ).rows[0].password_hash;
    await this.db.query("DELETE FROM account_sessions WHERE expires_at<=$1", [
      Date.now(),
    ]);
  }
  async authenticate(username: string, password: string) {
    const row = (
      await this.db.query(
        "SELECT * FROM accounts WHERE username=$1 COLLATE NOCASE",
        [username.trim()],
      )
    ).rows[0];
    const valid = await verifyPassword(
      password,
      row?.password_hash || this.dummyHash,
    );
    if (!row || !valid || row.status !== "active")
      throw new AppError("用户名或密码不正确", 401);
    return {
      user: accountIdentity(row),
      passwordHash: row.password_hash as string,
    };
  }
  async session(token?: string): Promise<UserIdentity | null> {
    if (!token) return null;
    const row = (
      await this.db.query(
        "SELECT a.* FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND a.status='active'",
        [tokenHash(token), Date.now()],
      )
    ).rows[0];
    return row ? accountIdentity(row) : null;
  }
  async createSession(
    credentials: { user: UserIdentity; passwordHash: string },
    previous?: string,
  ) {
    const token = newToken();
    const user = await this.db.transaction(async (tx) => {
      const row = (
        await tx.query("SELECT * FROM accounts WHERE id=$1", [
          credentials.user.id,
        ])
      ).rows[0];
      if (
        row?.status !== "active" ||
        row.password_hash !== credentials.passwordHash
      )
        throw new AppError("账号已失效，请重新登录", 401);
      if (previous)
        await tx.query("DELETE FROM account_sessions WHERE token_hash=$1", [
          tokenHash(previous),
        ]);
      await tx.query(
        "INSERT INTO account_sessions(token_hash,account_id,expires_at) VALUES($1,$2,$3)",
        [tokenHash(token), row.id, Date.now() + sessionDuration],
      );
      return accountIdentity(row);
    });
    return { token, user };
  }
  async logout(token?: string) {
    if (token)
      await this.db.query("DELETE FROM account_sessions WHERE token_hash=$1", [
        tokenHash(token),
      ]);
  }
  async changePassword(id: string, current: string, password: string) {
    if (id === OWNER_ID)
      throw new AppError("默认管理员密码由 APP_PASSWORD 配置管理", 403);
    validatePassword(password);
    const row = (
      await this.db.query(
        "SELECT password_hash FROM accounts WHERE id=$1 AND status='active'",
        [id],
      )
    ).rows[0];
    if (
      !row?.password_hash ||
      !(await verifyPassword(current, row.password_hash))
    )
      throw new AppError("原密码不正确");
    const hash = await hashPassword(password);
    await this.db.transaction(async (tx) => {
      const result = await tx.query(
        "UPDATE accounts SET password_hash=$2 WHERE id=$1 AND status='active' AND password_hash=$3",
        [id, hash, row.password_hash],
      );
      if (!result.rowCount)
        throw new AppError("账号状态已变化，请重新登录", 409);
      await tx.query("DELETE FROM account_sessions WHERE account_id=$1", [id]);
    });
  }
  // Deployment recovery applies to an identity, never to its workspace role.
  async resetPassword(username: string, password: string) {
    if (username.trim().toLowerCase() === OWNER_USERNAME)
      throw new AppError("默认管理员请修改 APP_PASSWORD 并重启");
    validatePassword(password);
    const hash = await hashPassword(password);
    await this.db.transaction(async (tx) => {
      const result = await tx.query(
        "UPDATE accounts SET password_hash=$2,status='active' WHERE username=$1 COLLATE NOCASE AND status<>'deleted'",
        [username.trim(), hash],
      );
      if (!result.rowCount) throw new AppError("账号不存在", 404);
      await tx.query(
        "DELETE FROM account_sessions WHERE account_id=(SELECT id FROM accounts WHERE username=$1 COLLATE NOCASE)",
        [username.trim()],
      );
    });
  }
}
