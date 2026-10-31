/**
 * Mole lab server (Hono, :8788). Everything the live demo shows comes from here, and everything here is real:
 *
 *   GET  /lab/health                      docker + sandbox image + registry reachability + record size
 *   GET  /lab/crawl?pages=N               SSE: crawl the official MCP Registry page by page (+ the lab's planted cases)
 *   GET  /lab/search?q=                   registry search (latest versions)
 *   POST /lab/trials {id, version?}       start a trial → {trialId}
 *   GET  /lab/trials/:id/events           SSE: replay + live trial events
 *   GET  /lab/trials/:id                  the trial record (evidence pack)
 *   POST /lab/watch {id}                  start release watch → {watchId}
 *   GET  /lab/watch/:id/events            SSE: watch progress
 *   GET  /lab/record                      index (latest per listing@version) + stats
 *   GET  /lab/gate?id=&version=           install decision for an agent
 *   GET  /lab/badge/:id.svg?version=      measured badge
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import { Lab, LAB_LISTINGS, badgeSvg, type Stream } from "./lab.js";
import { fetchPage, pingRegistry } from "./registry.js";
import { ensureImage, sandboxStatus } from "./sandbox.js";

const lab = new Lab();
const app = new Hono();

app.use("*", async (c, next) => {
  c.header("access-control-allow-origin", "*");
  c.header("access-control-allow-headers", "*");
  c.header("access-control-allow-methods", "GET,POST,OPTIONS");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

/** Server-sent events from a replayable Stream (or an async producer). */
function sse<E>(c: Context, stream: Stream<E>): Response {
  return new Response(new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const close = () => { if (closed) return; closed = true; clearInterval(ping); off(); try { controller.close(); } catch { /* closed */ } };
      const send = (e: E | undefined) => {
        if (closed) return;
        if (e === undefined) { controller.enqueue(enc.encode(`event: end\ndata: {}\n\n`)); close(); return; }
        controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      for (const e of stream.events) send(e);
      const off = stream.subscribe(send);
      const ping = setInterval(() => { if (!closed) controller.enqueue(enc.encode(": ping\n\n")); }, 15000);
      if (stream.done) send(undefined);
      c.req.raw.signal.addEventListener("abort", close);
    },
  }), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}

const health = async () => {
  const [sandbox, registry] = await Promise.all([sandboxStatus(), pingRegistry()]);
  return { ok: registry.ok, service: "mole-lab", sandbox, registry, record: lab.record.stats() };
};
app.get("/health", async (c) => c.json(await health()));
app.get("/lab/health", async (c) => c.json(await health()));

app.get("/lab/crawl", (c) => {
  const pages = Math.min(Number(c.req.query("pages") ?? 5), 30);
  return new Response(new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("lab", { listings: LAB_LISTINGS });
      let cursor: string | undefined;
      let total = 0;
      const counts: Record<string, number> = {};
      let runnable = 0;
      try {
        for (let i = 0; i < pages; i++) {
          const t = Date.now();
          const { listings, next } = await fetchPage(cursor, 100);
          lab.remember(listings);
          total += listings.length;
          for (const l of listings) { counts[l.kind] = (counts[l.kind] ?? 0) + 1; if (l.runnable) runnable++; }
          send("page", { page: i + 1, ms: Date.now() - t, listings, total, runnable, counts });
          if (!next) break;
          cursor = next;
        }
        send("done", { total, runnable, counts });
      } catch (e) {
        send("error", { message: (e as Error).message });
      }
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" } });
});

app.get("/lab/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const { listings } = await fetchPage(undefined, 30, q);
  lab.remember(listings);
  return c.json({ listings });
});

app.post("/lab/trials", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: string; version?: string };
  if (!body.id) return c.json({ error: "id required" }, 400);
  try {
    const listing = await lab.resolveListing(body.id, body.version);
    const run = lab.startTrial(listing, body.version);
    return c.json({ trialId: run.id, listing, version: run.version });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 404);
  }
});

app.get("/lab/trials/:id/events", (c) => {
  const run = lab.trials.get(c.req.param("id"));
  if (!run) return c.text("unknown trial", 404);
  return sse(c, run.stream);
});

app.get("/lab/trials/:id", (c) => {
  const id = c.req.param("id");
  const rec = lab.record.get(id) ?? lab.trials.get(id)?.record;
  if (!rec) return c.json({ error: "not found (or still running)" }, 404);
  const listing = lab.listings.get(rec.listingId);
  return c.json({ record: rec, listing: listing ?? null, events: lab.trials.get(id)?.stream.events ?? [] });
});

app.post("/lab/watch", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return c.json({ error: "id required" }, 400);
  try {
    const w = await lab.startWatch(body.id);
    return c.json({ watchId: w.id });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

app.get("/lab/watch/:id/events", (c) => {
  const w = lab.watches.get(c.req.param("id"));
  if (!w) return c.text("unknown watch", 404);
  return sse(c, w.stream);
});

app.get("/lab/record", (c) => c.json({ stats: lab.record.stats(), index: lab.record.index() }));

app.get("/lab/gate", (c) => {
  const id = c.req.query("id");
  if (!id) return c.json({ error: "id required" }, 400);
  return c.json(lab.gate(id, c.req.query("version") || undefined));
});

app.get("/lab/badge/*", (c) => {
  const id = decodeURIComponent(c.req.path.replace(/^\/lab\/badge\//, "").replace(/\.svg$/, ""));
  const version = c.req.query("version") || undefined;
  const t = lab.record.latest(id, version);
  c.header("content-type", "image/svg+xml");
  c.header("cache-control", "no-cache");
  return c.body(badgeSvg("mole", t?.verdict ?? "untested", t?.version ?? version));
});

const port = Number(process.env.LAB_PORT ?? 8788);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[mole-lab] listening on http://127.0.0.1:${info.port}`);
  ensureImage().then(() => console.log("[mole-lab] sandbox image ready")).catch((e) => console.log(`[mole-lab] sandbox unavailable: ${(e as Error).message}`));
});
