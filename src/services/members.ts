import type { WorkspaceMember } from "../../shared/access";
import { api } from "./workspace-client.js";
export interface MemberInput {
  username: string;
  displayName: string;
  role: "editor" | "viewer";
  monthlyLimit: number | null;
  password?: string;
}
export interface Invitation {
  token: string;
  expiresAt: number;
}
export const listMembers = async (): Promise<WorkspaceMember[]> =>
  (await api("/api/members")).members;
export const createMember = (
  input: MemberInput,
): Promise<{ id: string; token?: string; expiresAt?: number }> =>
  api("/api/members", input);
export const updateMember = (
  id: string,
  input: Omit<MemberInput, "username" | "password"> & { enabled: boolean },
) => api(`/api/members/${encodeURIComponent(id)}`, input, "PATCH");
export const inviteMember = (id: string): Promise<Invitation> =>
  api(`/api/members/${encodeURIComponent(id)}/invitation`, {});
export const removeMember = (id: string) =>
  api(`/api/members/${encodeURIComponent(id)}`, undefined, "DELETE");
export const createInvitation = (
  role: "editor" | "viewer",
): Promise<Invitation> => api("/api/member-invitations", { role });
export const listInvitations = async (): Promise<
  {
    id: string;
    role: "editor" | "viewer";
    expiresAt: number;
    username?: string;
  }[]
> => (await api("/api/member-invitations")).invitations;
export const revokeInvitation = (id: string) =>
  api(`/api/member-invitations/${encodeURIComponent(id)}`, undefined, "DELETE");
export function invitationUrl(token: string) {
  const url = new URL("/invite", window.location.origin);
  url.hash = new URLSearchParams({ token }).toString();
  return url.href;
}
