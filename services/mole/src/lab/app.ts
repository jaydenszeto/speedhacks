/**
 * Mole lab API (Hono). Served locally by server.ts (:8788) and on Vercel by api/lab (scripts/build-vercel.ts).
 * Everything the live demo shows comes from here, and everything here is real:
 *
 *   GET  /lab/health                      sandbox (docker | microvm | none) + registry reachability + record size
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
 *
 *   GET  /lab/integrations                planted SaaS/AI integrations (trial them via POST /lab/trials, watch via /lab/watch)
 *   POST /lab/identities/run              start the planted-identity loop → {runId}; GET /lab/identities/runs/:id/events (SSE)
 *   GET  /lab/identities                  the identity ledger (masked)
 *   POST /lab/identities/check {text}     which vendor leaked? sightings for any text
 *   GET  /lab/report/:trialId             printable behavioral review (HTML; ?embed=1 drops the page chrome for iframes)
 *   GET  /lab/feed.json | /lab/feed.jsonl record feed for ratings / insurers / marketplaces (?lab=0 to drop planted cases)
 *   POST /lab/bom {text}                  behavioral bill of materials for a package.json, MCP config, or name@version list
 *
 * Single-request streams (what the web UI uses). Start and follow in ONE request, so they also work where requests
 * can land on different instances (serverless). Each ends only after the record is saved:
 *   GET  /lab/trials/run?id=&version=     SSE: {type:"trial", trialId, listing, version}, then the trial's events
 *   GET  /lab/watch/run?id=               SSE: watch events + {type:"trial-event", trialId, version, event} per version
 *   GET  /lab/identities/stream           SSE: the planted-identity loop
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { Lab, LAB_LISTINGS, Stream, badgeSvg } from "./lab.js";
import { INTEGRATION_LISTINGS } from "./integrations.js";
import { IdentityLedger, maskIdentity, runIdentityLab, type IdentityEvent } from "./identities.js";
import { behavioralBom, feed, reviewReportHtml } from "./products.js";
import { fetchPage, pingRegistry } from "./registry.js";
import { sandboxStatus } from "./sandbox.js";
import { BlobMirror, blobEnabled } from "./persist.js";

export const lab = new Lab();
const ledger = new IdentityLedger();
const identityRuns = new Map<string, Stream<IdentityEvent>>();
export const app = new Hono();

// Shared persistence when a Blob store is attached (serverless); a no-op locally.
const mirrors = blobEnabled()
  ? { record: new BlobMirror("mole/record.json", "trials", lab.record), ids: new BlobMirror("mole/identities.json", "identities", ledger) }
  : undefined;
const saveRecord = async () => { try { await mirrors?.record.push(); } catch (e) { console.error("[mole-lab] record save failed:", (e as Error).message); } };
const saveIds = async () => { try { await mirrors?.ids.push(); } catch (e) { console.error("[mole-lab] identities save failed:", (e as Error).message); } };
export const persistence = () => (mirrors ? "blob" : "local");

app.use("*", async (c, next) => {
  c.header("access-control-allow-origin", "*");
  c.header("access-control-allow-headers", "*");
  c.header("access-control-allow-methods", "GET,POST,OPTIONS");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  if (mirrors) {
    try { await Promise.all([mirrors.record.pull(1500), mirrors.ids.pull(1500)]); }
    catch (e) { console.error("[mole-lab] shared state pull failed:", (e as Error).message); }
  }
  await next();
});

/** Relay every event of `from` into `to` (replaying what already happened); `onEnd` runs once `from` ends. */
function pipe<E>(from: Stream<E>, push: (e: E) => void, onEnd: () => void) {
  for (const e of from.events) push(e);
  if (from.done) { onEnd(); return; }
  const off = from.subscribe((e) => { if (e === undefined) { off(); onEnd(); } else push(e); });
}

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
  return { ok: registry.ok, service: "mole-lab", sandbox, registry, record: lab.record.stats(), persistence: persistence(), host: process.env.VERCEL ? "vercel" : "local" };
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

app.get("/lab/trials/run", async (c) => {
  const id = c.req.query("id");
  const version = c.req.query("version") || undefined;
  const out = new Stream<unknown>();
  if (!id) { out.push({ type: "error", message: "id required" }); out.end(); return sse(c, out); }
  try {
    const listing = await lab.resolveListing(id, version);
    const run = lab.startTrial(listing, version);
    out.push({ type: "trial", trialId: run.id, listing, version: run.version });
    pipe(run.stream, (e) => out.push(e), () => void saveRecord().finally(() => out.end()));
  } catch (e) {
    out.push({ type: "error", message: (e as Error).message });
    out.end();
  }
  return sse(c, out);
});

app.get("/lab/watch/run", async (c) => {
  const id = c.req.query("id");
  const out = new Stream<unknown>();
  if (!id) { out.push({ type: "error", message: "id required" }); out.end(); return sse(c, out); }
  try {
    const w = await lab.startWatch(id);
    let open = 1; // the watch itself, plus one per trial it starts
    const settle = () => { if (--open === 0) void saveRecord().finally(() => out.end()); };
    pipe(w.stream, (e) => {
      out.push(e);
      if (e.type !== "watch-trial") return;
      const run = lab.trials.get(e.trialId);
      if (!run) return;
      open++;
      pipe(run.stream, (event) => out.push({ type: "trial-event", trialId: e.trialId, version: e.version, event }), settle);
    }, settle);
  } catch (e) {
    out.push({ type: "error", message: (e as Error).message });
    out.end();
  }
  return sse(c, out);
});

app.get("/lab/identities/stream", (c) => {
  const out = new Stream<IdentityEvent>();
  void runIdentityLab(ledger, (e) => out.push(e)).finally(() => void saveIds().finally(() => out.end()));
  return sse(c, out);
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

app.get("/lab/integrations", (c) => c.json({ listings: INTEGRATION_LISTINGS }));

app.post("/lab/identities/run", (c) => {
  const id = `ids_${Date.now().toString(36)}`;
  const stream = new Stream<IdentityEvent>();
  identityRuns.set(id, stream);
  void runIdentityLab(ledger, (e) => stream.push(e)).finally(() => void saveIds().finally(() => stream.end()));
  return c.json({ runId: id });
});
app.get("/lab/identities/runs/:id/events", (c) => {
  const s = identityRuns.get(c.req.param("id"));
  if (!s) return c.text("unknown run", 404);
  return sse(c, s);
});
app.get("/lab/identities", (c) => c.json({ identities: ledger.all().map(maskIdentity) }));
app.post("/lab/identities/check", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: string; source?: string };
  if (!body.text) return c.json({ error: "text required" }, 400);
  return c.json({ sightings: ledger.check(body.text.slice(0, 2_000_000), body.source ?? "pasted text") });
});

app.get("/lab/report/:id", (c) => {
  const id = c.req.param("id").replace(/\.html$/, "");
  const rec = lab.record.get(id);
  if (!rec) return c.text("no such trial on record", 404);
  return c.html(reviewReportHtml(rec, lab.listings.get(rec.listingId), { embed: c.req.query("embed") === "1" }));
});
app.get("/lab/feed.json", (c) => {
  const rows = feed(lab.record, { includeLab: c.req.query("lab") !== "0" });
  return c.json({ schema: "mole-feed/1", generatedAt: new Date().toISOString(), rows });
});
app.get("/lab/feed.jsonl", (c) => {
  c.header("content-type", "application/x-ndjson");
  return c.body(feed(lab.record, { includeLab: c.req.query("lab") !== "0" }).map((r) => JSON.stringify(r)).join("\n") + "\n");
});
app.post("/lab/bom", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  if (!body.text) return c.json({ error: "text required" }, 400);
  return c.json(behavioralBom(body.text.slice(0, 500_000), lab.record, (id) => lab.listings.get(id)?.pkg?.identifier));
});
