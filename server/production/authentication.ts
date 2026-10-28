import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  CurrentUser,
  Permission,
  UserIdentity,
} from "../../shared/access.js";
import { can } from "../../shared/access.js";
import { AppError } from "./types.js";
import { Accounts, sessionDuration } from "./accounts.js";
import type { Workflows } from "./workflows.js";
import { WorkspaceDirectory } from "./workspace-directory.js";
import { Invitations } from "./invitations.js";
import { assertSystemAdmin, recordAdminAudit } from "./admin.js";

declare module "fastify" {
  interface FastifyRequest {
    workspace: Workflows;
    user: CurrentUser | null;
    account: UserIdentity | null;
  }
  interface FastifyContextConfig {
    public?: boolean;
    accountOnly?: boolean;
    systemAdmin?: boolean;
    permission?: Permission;
  }
}
const cookieName = "tuxu_session";
export function registerAuthentication(
  app: FastifyInstance,
  accounts: Accounts,
  directory: WorkspaceDirectory,
) {
  const invitations = new Invitations(accounts.db);
  const sessionResult = async (
    account: UserIdentity | null,
    workspaceId?: string,
    adminMode = false,
  ) => ({
    authenticated: !!account,
    account,
    user: account
      ? await directory.context(account.id, workspaceId, adminMode)
      : null,
  });
  const tokenFor = (request: FastifyRequest) =>
    (request.headers.cookie || "")
      .split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
  const cookie = (request: FastifyRequest, token: string, maxAge: number) =>
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${request.protocol === "https" ? "; Secure" : ""}`;
  app.decorateRequest("user", null);
  app.decorateRequest("account", null);
  const attempts = new Map<string, { count: number; expires: number }>();
  let verifying = 0;
  async function limited<T>(request: FastifyRequest, work: () => Promise<T>) {
    const now = Date.now();
    for (const [key, value] of attempts)
      if (value.expires <= now) attempts.delete(key);
    if (!attempts.has(request.ip) && attempts.size >= 10000)
      throw new AppError("登录繁忙，请稍后重试", 429);
    const entry = attempts.get(request.ip) || {
      count: 0,
      expires: now + 15 * 60000,
    };
    attempts.set(request.ip, entry);
    if (++entry.count > 20 || verifying >= 2)
      throw new AppError("尝试过于频繁，请稍后再试", 429);
    verifying++;
    try {
      return await work();
    } finally {
      verifying--;
    }
  }
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (!path.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.origin;
      let sameOrigin = !origin;
      try {
        if (origin)
          sameOrigin =
            new URL(origin).origin === `${request.protocol}://${request.host}`;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin || request.headers["sec-fetch-site"] === "cross-site")
        throw new AppError("不允许跨站修改", 403);
    }
    if (request.routeOptions.config.public) return;
    request.account = await accounts.session(tokenFor(request));
    if (!request.account)
      return reply.code(401).send({ error: "登录已失效，请重新登录" });
    const query = new URL(request.url, "http://localhost").searchParams;
    const expectedAccount =
      request.headers["x-account-id"] || query.get("account");
    if (expectedAccount && expectedAccount !== request.account.id)
      throw new AppError("登录账号已切换，请刷新页面或重新登录", 401);
    if (
      path.startsWith("/api/admin/") ||
      request.routeOptions.config.systemAdmin
    ) {
      if (request.account.systemRole !== "super_admin")
        throw new AppError("仅超级管理员可访问管理台", 403);
      return;
    }
    if (request.routeOptions.config.accountOnly) return;
    const asset = path.match(/^\/api\/assets\/([a-f0-9]{64})(?:\/thumbnail)?$/);
    let assetPage: URLSearchParams | undefined;
    if (asset && request.headers.referer) {
      try {
        const referer = new URL(request.headers.referer);
        if (
          referer.origin ===
            new URL(`${request.protocol}://${request.host}`).origin &&
          referer.searchParams.get("admin") === "1" &&
          !!referer.searchParams.get("workspace")
        )
          assetPage = referer.searchParams;
      } catch {
        // An invalid or external referrer cannot establish management intent.
      }
    }
    let expected =
      request.headers["x-workspace-id"] ||
      (["/api/analysis/events", "/api/workspace/events"].includes(path) ||
      path.startsWith("/api/assets/")
        ? query.get("workspace") || assetPage?.get("workspace")
        : undefined);
    if (asset && !expected)
      expected = (
        await accounts.db.query("SELECT workspace_id FROM assets WHERE id=$1", [
          asset[1],
        ])
      ).rows[0]?.workspace_id;
    if (expected && typeof expected !== "string")
      throw new AppError("工作区参数无效");
    const adminMode =
      request.headers["x-admin-mode"] === "1" ||
      query.get("admin") === "1" ||
      !!assetPage;
    if (adminMode && request.account.systemRole !== "super_admin")
      throw new AppError("仅超级管理员可使用管理模式", 403);
    request.user = await directory.context(
      request.account.id,
      expected as string | undefined,
      adminMode,
    );
    if (!request.user)
      throw new AppError(
        asset ? "图片不存在" : "你已无权访问此工作区，或工作区已归档",
        asset ? 404 : 403,
      );
    const permission =
      request.routeOptions.config.permission ||
      (!["GET", "HEAD"].includes(request.method) ? "edit" : undefined);
    const adminRead =
      ["GET", "HEAD"].includes(request.method) &&
      request.user.accessMode === "admin" &&
      request.user.systemRole === "super_admin";
    if (permission && !adminRead && !can(request.user, permission))
      throw new AppError(
        permission === "manage"
          ? "仅所有者可执行此操作"
          : "查看者只能查看和下载资料",
        403,
      );
  });
  app.get(
    "/api/auth/session",
    { config: { public: true } },
    async (request, reply) => {
      const account = await accounts.session(tokenFor(request));
      // Upgrade a cookie created during local HTTP use when the site enables TLS.
      // The database expiry remains authoritative and is never extended here.
      if (account && request.protocol === "https")
        reply.header(
          "Set-Cookie",
          cookie(request, tokenFor(request)!, sessionDuration / 1000),
        );
      const sessionQuery = new URL(request.url, "http://localhost")
        .searchParams;
      const workspaceId = sessionQuery.get("workspace") || undefined;
      const adminMode = sessionQuery.get("admin") === "1";
      if (adminMode && account && account.systemRole !== "super_admin")
        throw new AppError("仅超级管理员可使用管理模式", 403);
      const result = await sessionResult(account, workspaceId, adminMode);
      if (account && result.user?.accessMode === "admin")
        await accounts.db.transaction(async (tx) => {
          await assertSystemAdmin(tx, account.id);
          await recordAdminAudit(tx, {
            actorId: account.id,
            action: "workspace.access",
            workspaceId: result.user!.workspaceId,
            requestId: request.id,
          });
        });
      return result;
    },
  );
  const passwordSchema = { type: "string", minLength: 1, maxLength: 4096 };
  app.post<{ Body: { username: string; password: string } }>(
    "/api/auth/login",
    {
      config: { public: true },
      bodyLimit: 8192,
      schema: {
        body: {
          type: "object",
          required: ["username", "password"],
          additionalProperties: false,
          properties: {
            username: { type: "string", minLength: 1, maxLength: 100 },
            password: passwordSchema,
          },
        },
      },
    },
    async (request, reply) =>
      limited(request, async () => {
        const credentials = await accounts.authenticate(
          request.body.username,
          request.body.password,
        );
        const { token, user } = await accounts.createSession(
          credentials,
          tokenFor(request),
        );
        reply.header(
          "Set-Cookie",
          cookie(request, token, sessionDuration / 1000),
        );
        reply.header("Clear-Site-Data", '"cache"');
        return sessionResult(user);
      }),
  );
  app.post(
    "/api/auth/logout",
    { config: { public: true } },
    async (request, reply) => {
      const user = await accounts.session(tokenFor(request));
      if (
        user &&
        request.headers["x-account-id"] &&
        request.headers["x-account-id"] !== user.id
      )
        throw new AppError("登录账号已切换，请刷新页面或重新登录", 401);
      await accounts.logout(tokenFor(request));
      reply.header("Set-Cookie", cookie(request, "", 0));
      reply.header("Clear-Site-Data", '"cache"');
      return { authenticated: false, user: null };
    },
  );
  app.post<{ Body: { token: string } }>(
    "/api/auth/invitation",
    {
      config: { public: true },
      bodyLimit: 1024,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["token"],
          properties: {
            token: { type: "string", minLength: 40, maxLength: 100 },
          },
        },
      },
    },
    (request) => invitations.inspect(request.body.token),
  );
  app.post<{
    Body: {
      token: string;
      password?: string;
      username?: string;
      displayName?: string;
    };
  }>(
    "/api/auth/accept-invitation",
    {
      config: { public: true },
      bodyLimit: 8192,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["token"],
          properties: {
            token: { type: "string", minLength: 40, maxLength: 100 },
            password: { type: "string", minLength: 10, maxLength: 256 },
            username: { type: "string", minLength: 3, maxLength: 40 },
            displayName: { type: "string", minLength: 1, maxLength: 60 },
          },
        },
      },
    },
    async (request, reply) =>
      limited(request, async () => {
        const actor = await accounts.session(tokenFor(request));
        const credentials = await invitations.accept(
          request.body.token,
          request.body,
          actor,
        );
        if (actor?.id !== credentials.user.id) {
          const { token } = await accounts.createSession(
            credentials,
            tokenFor(request),
          );
          reply.header(
            "Set-Cookie",
            cookie(request, token, sessionDuration / 1000),
          );
          reply.header("Clear-Site-Data", '"cache"');
        }
        return sessionResult(credentials.user, credentials.workspaceId);
      }),
  );
  app.post<{ Body: { currentPassword: string; password: string } }>(
    "/api/auth/password",
    {
      config: { public: true },
      bodyLimit: 8192,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["currentPassword", "password"],
          properties: {
            currentPassword: passwordSchema,
            password: { type: "string", minLength: 10, maxLength: 256 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await accounts.session(tokenFor(request));
      if (!user) throw new AppError("登录已失效，请重新登录", 401);
      if (
        request.headers["x-account-id"] &&
        request.headers["x-account-id"] !== user.id
      )
        throw new AppError("登录账号已切换，请刷新页面或重新登录", 401);
      await limited(request, () =>
        accounts.changePassword(
          user.id,
          request.body.currentPassword,
          request.body.password,
        ),
      );
      reply.header("Set-Cookie", cookie(request, "", 0));
      return { authenticated: false };
    },
  );
  return {
    authenticated: async (request: FastifyRequest) => {
      const account = await accounts.session(tokenFor(request));
      return !!(
        account &&
        account.id === request.account?.id &&
        request.user &&
        (await directory.context(
          account.id,
          request.user.workspaceId,
          request.user.accessMode === "admin",
        ))
      );
    },
  };
}
