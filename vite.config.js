import { defineConfig, loadEnv } from "vite";
import { readFileSync } from "node:fs";
import { Agent } from "node:https";
import { grsaiPlugin } from "./server/demo/grsai.js";
import { shimoImages } from "./server/demo/legacy-shimo.js";
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  let https;
  if (command === "serve" && mode !== "demo") {
    if (!!env.TLS_CERT_FILE !== !!env.TLS_KEY_FILE)
      throw new Error("TLS_CERT_FILE 和 TLS_KEY_FILE 必须同时配置");
    if (env.TLS_CERT_FILE)
      https = {
        cert: readFileSync(env.TLS_CERT_FILE),
        key: readFileSync(env.TLS_KEY_FILE),
        minVersion: "TLSv1.2",
      };
  }
  const host =
    env.HOST === "0.0.0.0"
      ? "127.0.0.1"
      : env.HOST === "::"
        ? "::1"
        : env.HOST || "127.0.0.1";
  const target = `${https ? "https" : "http"}://${host.includes(":") ? `[${host}]` : host}:${env.PORT || 3001}`;
  const { version } = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  );
  return {
    define: { __APP_VERSION__: JSON.stringify(version) },
    esbuild: { jsx: "automatic" },
    // Existing browser tabs may still request chunks from the preceding build.
    build: { emptyOutDir: false },
    plugins: mode === "demo" ? [shimoImages(), grsaiPlugin()] : [],
    server:
      mode === "demo"
        ? {}
        : {
            https,
            proxy: {
              "/api": {
                target,
                changeOrigin: false,
                ...(https
                  ? {
                      agent: new Agent({
                        ...(env.TLS_CA_FILE
                          ? { ca: readFileSync(env.TLS_CA_FILE) }
                          : {}),
                      }),
                    }
                  : {}),
              },
            },
          },
    optimizeDeps: { include: ["exceljs"] },
  };
});
