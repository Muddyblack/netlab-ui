import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";

function appVersion() {
  if (process.env.NETLAB_GUI_VERSION) return process.env.NETLAB_GUI_VERSION;
  if (process.env.VITE_NETLAB_GUI_VERSION) return process.env.VITE_NETLAB_GUI_VERSION;
  try {
    return execFileSync("git", ["describe", "--tags", "--dirty", "--always"], { encoding: "utf-8" }).trim() || "dev";
  } catch {
    return "dev";
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  cacheDir: "/tmp/vite-cache-netlab",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  plugins: [react()],
  optimizeDeps: {
    include: ["monaco-editor/esm/vs/editor/editor.worker.js"],
  },
  resolve: {
    dedupe: ["react", "react-dom", "@emotion/react", "@emotion/styled", "@mui/material"],
  },
  server: {
    // Keep browser traffic same-origin in development. This covers ordinary
    // fetches, long-lived SSE streams, and shell WebSockets without depending
    // on which hostname was used to open Vite.
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8000",
        changeOrigin: true,
        ws: true,
      },
      "/mcp": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
