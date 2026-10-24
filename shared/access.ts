export type Role = "owner" | "editor" | "viewer";
export type Permission = "edit" | "manage";
export interface UserIdentity {
  id: string;
  username: string;
  displayName: string;
}
export interface CurrentUser extends UserIdentity {
  workspaceId: string;
  workspaceName: string;
  role: Role;
}
export interface WorkspaceSummary {
  id: string;
  name: string;
  role: Role;
  memberCount: number;
  archivedAt: number | null;
  createdAt: number;
}
export interface WorkspaceInvitation {
  workspaceId: string;
  workspaceName: string;
  role: "editor" | "viewer";
  username?: string;
  displayName?: string;
  accountId?: string;
  requiresLogin: boolean;
}
export interface WorkspaceMember extends CurrentUser {
  status: "pending" | "active" | "disabled";
  monthlyLimit: number | null;
  used: number;
  period: string;
  createdAt: number;
}
export const OWNER_ID = "owner";
export const OWNER_USERNAME = "admin";
export const roleLabels: Record<Role, string> = {
  owner: "所有者",
  editor: "编辑者",
  viewer: "查看者",
};
export function can(role: Role, permission: Permission) {
  return role === "owner" || (permission === "edit" && role === "editor");
}
// Viewing and downloading never change shared selections or workspace data.
const readActions = new Set([
  "view",
  "open-product",
  "queue-open-product",
  "filter-tasks",
  "close-modal",
  "activity",
  "view-version",
  "prompt-history",
  "download-version",
  "download-selected",
  "download-batch-selected",
  "export-excel",
  "backup",
  "manage-photos",
  "upload-photo",
  "manage-references",
  "view-product",
  "view-requirements",
  "close-assistant",
]);
export function actionAllowed(role: Role, action: string) {
  if (["settings", "clear-key", "clear-prompt-key", "restore"].includes(action))
    return can(role, "manage");
  return readActions.has(action) || can(role, "edit");
}
