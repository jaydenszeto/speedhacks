import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { moleLive } from "./vite-mole-live";

// Multi-page: the Mole lab (index.html, the live product demo), the legacy Tripwire dashboard, and the hire replay demo.
export default defineConfig({
  plugins: [react(), moleLive()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        dashboard: resolve(__dirname, "dashboard.html"),
        demo: resolve(__dirname, "demo.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/lab": { target: `http://127.0.0.1:${process.env.LAB_PORT ?? 8788}`, changeOrigin: true },
      "/api": "http://127.0.0.1:8787",
      "/t": "http://127.0.0.1:8787",
      "/webhooks": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
    },
  },
});
