/** Thin client for the lab server. Every stream resolves when the server sends `end` (or the crawl's `done`). */
import type { Bom, FeedRow, GateResult, Health, IdentityEvent, LabEvent, Listing, MaskedIdentity, Sighting, Stats, TrialRecord, WatchEvent } from "./types";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

const post = <T,>(url: string, body: unknown) =>
  json<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const getHealth = () => json<Health>("/lab/health");
/** Can this host trial registry servers? (Older lab builds report only docker + image.) */
export const sandboxReady = (h: Health) => h.sandbox.ready ?? (h.sandbox.docker && h.sandbox.image);
export const getRecord = () => json<{ stats: Stats; index: TrialRecord[] }>("/lab/record");
export const getGate = (id: string, version?: string) =>
  json<GateResult>(`/lab/gate?id=${encodeURIComponent(id)}${version ? `&version=${encodeURIComponent(version)}` : ""}`);
export const searchRegistry = (q: string) => json<{ listings: Listing[] }>(`/lab/search?q=${encodeURIComponent(q)}`);
export const startTrial = (id: string, version?: string) => post<{ trialId: string; listing: Listing; version: string }>("/lab/trials", { id, version });
export const startWatch = (id: string) => post<{ watchId: string }>("/lab/watch", { id });
export const badgeUrl = (id: string, version?: string) => `/lab/badge/${encodeURIComponent(id)}.svg${version ? `?version=${encodeURIComponent(version)}` : ""}`;
export const evidenceUrl = (trialId: string) => `/lab/trials/${trialId}`;
export const reportUrl = (trialId: string) => `/lab/report/${trialId}`;
export const getIntegrations = () => json<{ listings: Listing[] }>("/lab/integrations");
export const startIdentityRun = () => post<{ runId: string }>("/lab/identities/run", {});
export const getIdentities = () => json<{ identities: MaskedIdentity[] }>("/lab/identities");
export const checkIdentities = (text: string) => post<{ sightings: Sighting[] }>("/lab/identities/check", { text });
export const getFeed = (includeLab = true) => json<{ schema: string; generatedAt: string; rows: FeedRow[] }>(`/lab/feed.json${includeLab ? "" : "?lab=0"}`);
export const postBom = (text: string) => post<Bom>("/lab/bom", { text });

/** Subscribe to an SSE stream of `data:` events until the server sends `end`. */
export function follow<E>(url: string, onEvent: (e: E) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(url);
    const finish = () => { es.close(); resolve(); };
    es.onmessage = (m) => { try { onEvent(JSON.parse(m.data) as E); } catch { /* ignore malformed */ } };
    es.addEventListener("end", finish);
    es.onerror = () => { es.close(); reject(new Error("lost connection to the lab")); };
    signal?.addEventListener("abort", finish);
  });
}

export interface CrawlHandlers {
  onLab: (ls: Listing[]) => void;
  onPage: (p: { page: number; ms: number; listings: Listing[]; total: number; runnable: number; counts: Record<string, number> }) => void;
}

/** Crawl the registry: named events lab → page × N → done. */
export function crawl(pages: number, h: CrawlHandlers): Promise<{ total: number; runnable: number; counts: Record<string, number> }> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/lab/crawl?pages=${pages}`);
    es.addEventListener("lab", (m) => h.onLab((JSON.parse((m as MessageEvent).data) as { listings: Listing[] }).listings));
    es.addEventListener("page", (m) => h.onPage(JSON.parse((m as MessageEvent).data)));
    es.addEventListener("done", (m) => { es.close(); resolve(JSON.parse((m as MessageEvent).data)); });
    es.addEventListener("error", (m) => {
      es.close();
      const data = (m as MessageEvent).data;
      reject(new Error(data ? (JSON.parse(data) as { message: string }).message : "crawl connection failed"));
    });
  });
}

export const followTrial = (trialId: string, onEvent: (e: LabEvent) => void, signal?: AbortSignal) =>
  follow<LabEvent>(`/lab/trials/${trialId}/events`, onEvent, signal);
export const followWatch = (watchId: string, onEvent: (e: WatchEvent) => void, signal?: AbortSignal) =>
  follow<WatchEvent>(`/lab/watch/${watchId}/events`, onEvent, signal);
export const followIdentities = (runId: string, onEvent: (e: IdentityEvent) => void, signal?: AbortSignal) =>
  follow<IdentityEvent>(`/lab/identities/runs/${runId}/events`, onEvent, signal);

/*
 * Single-request streams: start and follow in one request. This is what the UI uses, because on a serverless host the
 * "start" and "follow" requests could land on different instances. Each stream ends after the record is saved.
 */
export type TrialRunEvent = LabEvent | { type: "trial"; trialId: string; listing: Listing; version: string };
export type WatchRunEvent = WatchEvent | { type: "trial-event"; trialId: string; version: string; event: LabEvent };
const qs = (o: Record<string, string | undefined>) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
export const runTrialStream = (id: string, version: string | undefined, onEvent: (e: TrialRunEvent) => void) =>
  follow<TrialRunEvent>(`/lab/trials/run?${qs({ id, version })}`, onEvent);
export const runWatchStream = (id: string, onEvent: (e: WatchRunEvent) => void) =>
  follow<WatchRunEvent>(`/lab/watch/run?${qs({ id })}`, onEvent);
export const runIdentityStream = (onEvent: (e: IdentityEvent) => void) => follow<IdentityEvent>("/lab/identities/stream", onEvent);
