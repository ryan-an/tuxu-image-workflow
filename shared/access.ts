export type Role = "owner" | "editor" | "viewer";
export type Permission = "edit" | "manage";
export type SystemRole = "user" | "super_admin";
export type AccessMode = "member" | "admin";
export interface UserIdentity {
  id: string;
  username: string;
  displayName: string;
  systemRole?: SystemRole;
}
export interface CurrentUser extends UserIdentity {
  workspaceId: string;
  workspaceName: string;
  role: Role;
  accessMode?: AccessMode;
  archivedAt?: number | null;
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
  accountStatus?: "pending" | "active" | "disabled" | "deleted";
  acceptedAt?: number | null;
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
export function can(subject: Role | CurrentUser, permission: Permission) {
  if (typeof subject !== "string" && subject.accessMode === "admin")
    return subject.systemRole === "super_admin" && subject.archivedAt == null;
  const role = typeof subject === "string" ? subject : subject.role;
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
  "export-template",
  "backup",
  "manage-photos",
  "upload-photo",
  "manage-references",
  "view-product",
  "view-requirements",
  "close-assistant",
]);
export function actionAllowed(role: Role | CurrentUser, action: string) {
  if (["api-keys", "clear-key", "clear-prompt-key", "restore"].includes(action))
    return can(role, "manage");
  return readActions.has(action) || can(role, "edit");
}
