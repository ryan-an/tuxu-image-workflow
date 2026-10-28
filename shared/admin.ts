import type { Role, SystemRole } from "./access.js";

export type AccountStatus = "active" | "pending" | "disabled";
export interface AdminPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface AdminAccount {
  id: string;
  username: string;
  displayName: string;
  systemRole: SystemRole;
  status: AccountStatus;
  workspaceCount: number;
  ownedWorkspaceCount: number;
  createdAt: number;
}
export interface AdminAccountWorkspace {
  id: string;
  name: string;
  role: Role;
  memberStatus: "active" | "pending" | "disabled";
  archivedAt: number | null;
  used: number;
  period: string;
}
export interface AdminAccountDetail {
  account: AdminAccount;
  workspaces: AdminAccountWorkspace[];
}
export interface AdminWorkspace {
  id: string;
  name: string;
  owner: {
    id: string;
    username: string;
    displayName: string;
    status: AccountStatus;
  };
  memberCount: number;
  archivedAt: number | null;
  createdAt: number;
}
export interface AdminUsage {
  period: string;
  total: number;
  administrator: number;
  members: {
    accountId: string;
    username: string;
    displayName: string;
    used: number;
    administrator: boolean;
  }[];
}
export interface AdminWorkspaceDetail {
  workspace: AdminWorkspace;
  usage: AdminUsage;
}
export interface AdminAuditLog {
  id: string;
  createdAt: number;
  actorId: string;
  actorUsername: string;
  action: string;
  targetAccountId: string | null;
  targetUsername: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  result: "success" | "failure";
  requestId: string;
  errorCode: string | null;
  changes: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
}
