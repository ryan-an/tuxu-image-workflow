export const authenticationRequired = "tuxu:authentication-required";

async function authRequest(path: string, body?: object) {
  const response = await fetch(`/api/auth/${path}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败，请稍后重试");
  return data as { authenticated: boolean };
}

export async function getSession() {
  return (await authRequest("session")).authenticated;
}
export async function login(username: string, password: string) {
  await authRequest("login", { username, password });
}
export async function logout() {
  await authRequest("logout", {});
}
