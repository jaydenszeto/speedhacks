/** Mole lab server for local runs (Hono on :8788). The API itself lives in app.ts; Vercel serves the same app. */
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { ensureImage } from "./sandbox.js";

const port = Number(process.env.LAB_PORT ?? 8788);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[mole-lab] listening on http://127.0.0.1:${info.port}`);
  ensureImage().then(() => console.log("[mole-lab] sandbox image ready")).catch((e) => console.log(`[mole-lab] sandbox unavailable: ${(e as Error).message}`));
});
