import { randomUUID } from "node:crypto";
import type { Database } from "./types.js";
import { AppError } from "./types.js";
import { hashPassword, validatePassword } from "./passwords.js";
import { validUsername } from "./members.js";
import { emptyWorkspace } from "./repository.js";
import { Accounts } from "./accounts.js";

// Deployment convenience for provisioning a new identity with its first workspace.
// Regular users create additional workspaces through WorkspaceDirectory instead.
export class Provisioning {
  constructor(private db: Database) {}
  async provisionTeam(input: {
    username: string;
    password: string;
    workspaceName: string;
    displayName?: string;
  }) {
    const username = validUsername(input.username),
      name = input.workspaceName.trim();
    if (username === "admin") throw new AppError("admin 已预留");
    if (!name || name.length > 60)
      throw new AppError("工作区名称须为 1～60 字");
    validatePassword(input.password);
    const hash = await hashPassword(input.password),
      id = randomUUID(),
      workspaceId = randomUUID(),
      { products, jobs, ...document } = emptyWorkspace();
    await this.db.transaction(async (tx) => {
      if (
        (
          await tx.query(
            "SELECT id FROM accounts WHERE username=$1 COLLATE NOCASE",
            [username],
          )
        ).rows.length
      )
        throw new AppError("用户名已使用", 409);
      await tx.query(
        "INSERT INTO accounts(id,username,display_name,status,password_hash,created_at) VALUES($1,$2,$3,'active',$4,$5)",
        [id, username, input.displayName?.trim() || username, hash, Date.now()],
      );
      await tx.query(
        "INSERT INTO workspace(id,name,document,created_at) VALUES($1,$2,$3,$4)",
        [workspaceId, name, document, Date.now()],
      );
      await tx.query(
        "INSERT INTO workspace_members(workspace_id,account_id,display_name,role,status,created_at,accepted_at) VALUES($1,$2,$3,'owner','active',$4,$4)",
        [workspaceId, id, input.displayName?.trim() || username, Date.now()],
      );
    });
    return { id, username, workspaceId, workspaceName: name };
  }
  async teamOwners() {
    return (
      await this.db.query(
        "SELECT a.id,a.username,m.display_name AS displayName,m.workspace_id AS workspaceId,w.name AS workspaceName,m.status FROM workspace_members m JOIN accounts a ON a.id=m.account_id JOIN workspace w ON w.id=m.workspace_id WHERE m.role='owner' ORDER BY w.created_at,w.id",
      )
    ).rows;
  }
  async resetOwnerPassword(username: string, password: string) {
    await new Accounts(this.db).resetPassword(username, password);
  }
}
