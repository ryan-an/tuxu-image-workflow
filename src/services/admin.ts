import type {
  AdminAccount,
  AdminAccountDetail,
  AdminAuditLog,
  AdminPage,
  AdminWorkspace,
  AdminWorkspaceDetail,
} from "../../shared/admin";
import type { WorkspaceMember } from "../../shared/access";
import { api } from "./workspace-client.js";

export type AdminFilters = {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  action?: string;
  from?: string;
  to?: string;
};
const query = (input: object) => {
  const values = Object.entries(input).filter(
    ([, value]) => value !== undefined && value !== "",
  );
  return new URLSearchParams(
    values.map(([key, value]) => [key, String(value)]),
  ).toString();
};
const accountPath = (id: string) =>
  `/api/admin/accounts/${encodeURIComponent(id)}`;
const workspacePath = (id: string) =>
  `/api/admin/workspaces/${encodeURIComponent(id)}`;
export const adminAccounts = (
  filters: AdminFilters,
): Promise<AdminPage<AdminAccount>> =>
  api(`/api/admin/accounts?${query(filters)}`);
export const adminAccount = (id: string): Promise<AdminAccountDetail> =>
  api(accountPath(id));
export const createAdminAccount = (input: {
  username: string;
  displayName: string;
  password: string;
}) => api("/api/admin/accounts", input);
export const renameAdminAccount = (id: string, displayName: string) =>
  api(accountPath(id), { displayName }, "PATCH");
export const deleteAdminAccount = (id: string, username: string) =>
  api(accountPath(id), { username }, "DELETE");
export const adminAccountAction = (
  id: string,
  action: "reset-password" | "revoke-sessions" | "disable" | "enable",
  input: object = {},
) => api(`${accountPath(id)}/${action}`, input);
export const adminWorkspaces = (
  filters: AdminFilters,
): Promise<AdminPage<AdminWorkspace>> =>
  api(`/api/admin/workspaces?${query(filters)}`);
export const adminWorkspace = (
  id: string,
  period?: string,
): Promise<AdminWorkspaceDetail> =>
  api(
    `${workspacePath(id)}${period ? `?period=${encodeURIComponent(period)}` : ""}`,
  );
export const createAdminWorkspace = (input: {
  name: string;
  ownerId: string;
}) => api("/api/admin/workspaces", input);
export const renameAdminWorkspace = (id: string, name: string) =>
  api(workspacePath(id), { name }, "PATCH");
export const adminWorkspaceAction = (
  id: string,
  action: "archive" | "restore" | "transfer-owner" | "access",
  input: object = {},
) => api(`${workspacePath(id)}/${action}`, input);
export const adminAuditLogs = (
  filters: AdminFilters,
): Promise<AdminPage<AdminAuditLog>> =>
  api(`/api/admin/audit-logs?${query(filters)}`);

export interface AdminInvitation {
  id: string;
  role: "editor" | "viewer";
  expiresAt: number;
  username?: string;
}
export interface AdminSettings {
  hasKey: boolean;
  hasPromptKey: boolean;
  keyHint?: string;
  promptKeyHint?: string;
  imageModel: string;
  promptModel: string;
  baseUrl: string;
  mode: string;
  aspectRatio: string;
  imageSize: string;
  gptSize: string;
  quality: string;
}
// Each call carries its own target; opening a detail does not change the tab's workspace.
export const adminWorkspaceRequest = (
  id: string,
  path: string,
  body?: object,
  method = body ? "POST" : "GET",
) => api(path, body, method, { "X-Workspace-Id": id, "X-Admin-Mode": "1" });
export async function adminWorkspaceResources(id: string) {
  const [memberResult, invitationResult, settings] = await Promise.all([
    adminWorkspaceRequest(id, "/api/members"),
    adminWorkspaceRequest(id, "/api/member-invitations"),
    adminWorkspaceRequest(id, "/api/workflow/settings"),
  ]);
  return {
    members: memberResult.members as WorkspaceMember[],
    invitations: invitationResult.invitations as AdminInvitation[],
    settings: settings as AdminSettings,
  };
}
export async function enterAdminWorkspace(id: string) {
  await adminWorkspaceAction(id, "access");
  window.location.assign(`/?workspace=${encodeURIComponent(id)}&admin=1`);
}
