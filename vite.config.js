import { defineConfig } from "vite";
import { grsaiPlugin } from "./server/grsai.js";
import { shimoImages } from "./server/legacy-shimo.js";
export default defineConfig(({ mode }) => ({
  esbuild: { jsx: "automatic" },
  plugins: mode === "demo" ? [shimoImages(), grsaiPlugin()] : [],
  server:
    mode === "demo"
      ? {}
      : {
          proxy: {
            "/api": { target: "http://127.0.0.1:3001", changeOrigin: false },
          },
        },
  optimizeDeps: { include: ["exceljs"] },
}));
