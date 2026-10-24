export const authenticationRequired = "tuxu:authentication-required";
import type {
  CurrentUser,
  UserIdentity,
  WorkspaceInvitation,
} from "../../shared/access.js";
import { sessionHeaders } from "./session-scope.js";
import {
  allowsCredentials,
  insecureTransportMessage,
} from "../../shared/transport-security.js";
export interface Session {
  authenticated: boolean;
  user: CurrentUser | null;
  account: UserIdentity | null;
}

export class HttpsRequiredError extends Error {
  constructor() {
    super(insecureTransportMessage);
    this.name = "HttpsRequiredError";
  }
}

async function checkTransportPolicy() {
  const response = await fetch("/api/auth/transport-policy", {
    credentials: "omit",
    cache: "no-store",
  });
  const policy = await response.json();
  if (!response.ok || typeof policy.requireHttps !== "boolean")
    throw new Error("无法读取连接配置，请稍后重试");
  if (!allowsCredentials(window.location, policy.requireHttps))
    throw new HttpsRequiredError();
}

async function authRequest(path: string, body?: object) {
  await checkTransportPolicy();
  const response = await fetch(`/api/auth/${path}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...sessionHeaders(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body
      ? {
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (response.status === 426) throw new HttpsRequiredError();
  if (!response.ok) throw new Error(data.error || "请求失败，请稍后重试");
  return data as Session;
}

export async function getSession(workspaceId?: string) {
  return authRequest(
    `session${workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : ""}`,
  );
}
export async function login(username: string, password: string) {
  return authRequest("login", { username, password });
}
export async function logout() {
  await authRequest("logout", {});
}
export async function getInvitation(token: string) {
  return (await authRequest("invitation", {
    token,
  })) as unknown as WorkspaceInvitation;
}
export function acceptInvitation(
  token: string,
  input: { password?: string; username?: string; displayName?: string },
) {
  return authRequest("accept-invitation", { token, ...input });
}
export async function changePassword(
  currentPassword: string,
  password: string,
) {
  await authRequest("password", { currentPassword, password });
  window.dispatchEvent(new Event(authenticationRequired));
}
