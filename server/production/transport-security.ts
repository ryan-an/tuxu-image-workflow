import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import type { SecureContextOptions } from "node:tls";
import {
  insecureTransportMessage,
  isLoopbackHostname,
} from "../../shared/transport-security.js";
import { AppError } from "./types.js";

export interface TransportSecurityOptions {
  requireHttps?: boolean;
  https?: Pick<SecureContextOptions, "key" | "cert" | "minVersion">;
  trustedProxies?: string[];
  publicOrigin?: string;
}

export async function loadTransportSecurity(
  env: NodeJS.ProcessEnv,
): Promise<TransportSecurityOptions> {
  const requireHttps = (env.REQUIRE_HTTPS || "false").trim().toLowerCase();
  if (!["true", "false"].includes(requireHttps))
    throw new Error("REQUIRE_HTTPS 只能配置为 true 或 false");
  const certPath = env.TLS_CERT_FILE?.trim(),
    keyPath = env.TLS_KEY_FILE?.trim();
  if (!!certPath !== !!keyPath)
    throw new Error("TLS_CERT_FILE 和 TLS_KEY_FILE 必须同时配置");
  const trustedProxies = (env.TRUSTED_PROXIES || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  for (const proxy of trustedProxies) {
    const [address, prefix, ...rest] = proxy.split("/"),
      version = isIP(address);
    if (
      !version ||
      rest.length ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) ||
          Number(prefix) <= 0 ||
          Number(prefix) > (version === 4 ? 32 : 128)))
    )
      throw new Error(
        "TRUSTED_PROXIES 只允许明确的代理 IP 或受限 CIDR，不能信任全部来源",
      );
  }
  let publicOrigin: string | undefined;
  if (env.PUBLIC_ORIGIN?.trim()) {
    let url: URL;
    try {
      url = new URL(env.PUBLIC_ORIGIN.trim());
    } catch {
      throw new Error("PUBLIC_ORIGIN 必须是有效的 HTTPS 站点地址");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(
        "PUBLIC_ORIGIN 必须是 HTTPS 站点地址，不能包含路径或凭据",
      );
    publicOrigin = url.origin;
  }
  return {
    requireHttps: requireHttps === "true",
    trustedProxies,
    publicOrigin,
    ...(certPath && keyPath
      ? {
          https: {
            cert: await readFile(certPath),
            key: await readFile(keyPath),
            minVersion: "TLSv1.2",
          },
        }
      : {}),
  };
}

export function registerTransportSecurity(
  app: FastifyInstance,
  options: TransportSecurityOptions = {},
) {
  // Runtime policy keeps the browser and server on the same switch without rebuilding assets.
  app.get(
    "/api/auth/transport-policy",
    { config: { public: true } },
    (_request, reply) =>
      reply
        .header("Cache-Control", "no-store")
        .send({ requireHttps: options.requireHttps === true }),
  );
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    const navigation = new URL(request.url, "http://localhost");
    // Native images cannot attach workspace headers. Only the management
    // document sends its explicit scope back to this same origin; no referrer
    // is sent to external sites, and normal pages retain their existing policy.
    const managementDocument =
      ["GET", "HEAD"].includes(request.method) &&
      navigation.pathname === "/" &&
      navigation.searchParams.get("admin") === "1" &&
      !!navigation.searchParams.get("workspace");
    reply.header(
      "Referrer-Policy",
      managementDocument ? "same-origin" : "no-referrer",
    );
    if (request.protocol === "https") {
      if (!isLoopbackHostname(request.hostname))
        reply.header(
          "Strict-Transport-Security",
          options.requireHttps ? "max-age=31536000" : "max-age=0",
        );
      return;
    }
    if (!options.requireHttps) return;
    const path = request.url.split("?")[0];
    if (
      path === "/health" ||
      (path === "/api/auth/transport-policy" &&
        ["GET", "HEAD"].includes(request.method))
    )
      return;
    reply.header("Cache-Control", "no-store");
    // Only navigation is redirected: credential POST bodies must never be replayed.
    if (options.publicOrigin && ["GET", "HEAD"].includes(request.method)) {
      const incoming = new URL(request.url, "http://localhost");
      return reply.redirect(
        options.publicOrigin + incoming.pathname + incoming.search,
        308,
      );
    }
    throw new AppError(insecureTransportMessage, 426);
  });
}
