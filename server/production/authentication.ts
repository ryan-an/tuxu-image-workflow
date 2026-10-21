import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "./types.js";

const cookieName = "tuxu_session";
const sessionDuration = 12 * 60 * 60 * 1000;

export function registerAuthentication(app: FastifyInstance, password: string) {
  const sessions = new Map<string, number>();
  const expected = Buffer.from(password);
  const tokenFor = (request: FastifyRequest) =>
    (request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
  const authenticated = (request: FastifyRequest) => {
    const token = tokenFor(request);
    if (!token) return false;
    const expires = sessions.get(token);
    if (!expires || expires <= Date.now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  };
  const cookie = (request: FastifyRequest, token: string, maxAge: number) =>
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${request.protocol === "https" ? "; Secure" : ""}`;

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    reply.header("X-Content-Type-Options", "nosniff");
    if (!path.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.origin;
      let sameOrigin = !origin;
      try {
        if (origin) sameOrigin = new URL(origin).host === request.headers.host;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin || request.headers["sec-fetch-site"] === "cross-site")
        throw new AppError("不允许跨站修改", 403);
    }
    if (
      ["/api/auth/login", "/api/auth/logout", "/api/auth/session"].includes(
        path,
      )
    )
      return;
    if (!authenticated(request))
      return reply.code(401).send({ error: "登录已失效，请重新登录" });
  });

  app.get("/api/auth/session", async (request) => ({
    authenticated: authenticated(request),
  }));
  app.post<{ Body: { username: string; password: string } }>(
    "/api/auth/login",
    {
      bodyLimit: 8192,
      schema: {
        body: {
          type: "object",
          required: ["username", "password"],
          additionalProperties: false,
          properties: {
            username: { type: "string", minLength: 1, maxLength: 100 },
            password: { type: "string", minLength: 1, maxLength: 4096 },
          },
        },
      },
    },
    async (request, reply) => {
      const provided = Buffer.from(request.body.password);
      if (
        request.body.username !== "admin" ||
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
      )
        return reply.code(401).send({ error: "用户名或密码不正确" });
      for (const [token, expires] of sessions)
        if (expires <= Date.now()) sessions.delete(token);
      const previous = tokenFor(request);
      if (previous) sessions.delete(previous);
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value!);
      const token = randomBytes(32).toString("base64url");
      sessions.set(token, Date.now() + sessionDuration);
      reply.header(
        "Set-Cookie",
        cookie(request, token, sessionDuration / 1000),
      );
      return { authenticated: true };
    },
  );
  app.post("/api/auth/logout", async (request, reply) => {
    const token = tokenFor(request);
    if (token) sessions.delete(token);
    reply.header("Set-Cookie", cookie(request, "", 0));
    return { authenticated: false };
  });
  app.addHook("onClose", async () => sessions.clear());
  return { authenticated };
}
