import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { moleLive } from "./vite-mole-live";

// Multi-page: the dashboard (index.html) and the standalone demo (demo.html) build as separate entries.
export default defineConfig({
  plugins: [react(), moleLive()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        demo: resolve(__dirname, "demo.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/t": "http://127.0.0.1:8787",
      "/webhooks": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
    },
  },
});
