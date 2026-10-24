import type { WorkspaceSummary } from "../../shared/access";
import { api } from "./workspace-client.js";
export const listWorkspaces = async (): Promise<WorkspaceSummary[]> =>
  (await api("/api/workspaces")).workspaces;
export const createWorkspace = (name: string): Promise<{ id: string }> =>
  api("/api/workspaces", { name });
export const renameWorkspace = (id: string, name: string) =>
  api(`/api/workspaces/${encodeURIComponent(id)}`, { name }, "PATCH");
export const archiveWorkspace = (id: string, archived: boolean) =>
  api(`/api/workspaces/${encodeURIComponent(id)}/archive`, { archived });
export const leaveWorkspace = (id: string) =>
  api(`/api/workspaces/${encodeURIComponent(id)}/leave`, {});
export const transferWorkspace = (id: string, accountId: string) =>
  api(`/api/workspaces/${encodeURIComponent(id)}/transfer`, { accountId });
export function workspaceUrl(id: string) {
  return `/?workspace=${encodeURIComponent(id)}`;
}
export async function openWorkspace(
  id: string,
  flush?: () => Promise<unknown>,
) {
  if (flush) await flush();
  window.location.assign(workspaceUrl(id));
}
