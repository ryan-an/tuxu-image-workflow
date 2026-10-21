import { defineConfig } from "vite";
import { grsaiPlugin } from "./server/demo/grsai.js";
import { shimoImages } from "./server/demo/legacy-shimo.js";
export default defineConfig(({ mode }) => ({
  esbuild: { jsx: "automatic" },
  // Existing browser tabs may still request chunks from the preceding build.
  build: { emptyOutDir: false },
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
