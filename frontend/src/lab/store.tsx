/**
 * One store for the whole demo. Every action is a real call to the lab server and returns a promise that settles when
 * the real work finishes. That's what lets the autopilot simply `await` each step instead of faking timings.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import * as api from "./api";
import type { GateResult, Health, IdentityEvent, LabEvent, Listing, MaskedIdentity, Sighting, Stats, TrialRecord, Verdict } from "./types";

export interface CrawlState {
  status: "idle" | "crawling" | "done" | "error";
  lab: Listing[];
  listings: Listing[];
  total: number;
  runnable: number;
  counts: Record<string, number>;
  page: number;
  lastMs?: number;
  error?: string;
}

export interface TrialState {
  status: "idle" | "running" | "done" | "error";
  trialId?: string;
  listing?: Listing;
  version?: string;
  events: LabEvent[];
  record?: TrialRecord;
  error?: string;
  origin: "manual" | "watch";
}

export interface WatchState {
  status: "idle" | "running" | "done" | "error";
  listingId?: string;
  title?: string;
  versions: string[];
  results: Record<string, { verdict: Verdict; summary: string; trialId: string }>;
  current?: string;
  firstCaught?: string;
  error?: string;
}

/** Integration release watch: every version's full event stream, kept side by side. */
export interface IntegState {
  status: "idle" | "running" | "done" | "error";
  listingId?: string;
  versions: string[];
  current?: string;
  /** Which version the panels show. Follows the live trial, or the user's pick. */
  shown?: string;
  events: Record<string, LabEvent[]>;
  records: Record<string, TrialRecord>;
  error?: string;
}

export interface IdState {
  status: "idle" | "running" | "done" | "error";
  vendors: { id: string; does: string; channel: string }[];
  minted: Record<string, MaskedIdentity>;
  handoffs: Record<string, number>;
  sweeps: { source: string; detail: string; bytes: number }[];
  sightings: Sighting[];
  quiet?: string[];
  error?: string;
}

export interface GateLine { id: number; label: string; listingId: string; version?: string; result?: GateResult; error?: string }

export interface Pilot { running: boolean; step: number; total: number; label: string; done: boolean }

interface Store {
  health?: Health;
  stats?: Stats;
  index: TrialRecord[];
  crawl: CrawlState;
  trial: TrialState;
  watch: WatchState;
  gate: GateLine[];
  integrations: Listing[];
  integ: IntegState;
  ids: IdState;
  pilot: Pilot;
  setPilot: (p: Partial<Pilot>) => void;
  refreshHealth: () => Promise<void>;
  refreshRecord: () => Promise<void>;
  runCrawl: (pages?: number) => Promise<CrawlState>;
  runTrial: (listing: Listing, version?: string, origin?: TrialState["origin"]) => Promise<TrialRecord | undefined>;
  runWatch: (listingId: string) => Promise<WatchState>;
  runGate: (listingId: string, version: string | undefined, label: string) => Promise<GateResult | undefined>;
  clearGate: () => void;
  runIntegrationWatch: (listingId: string) => Promise<IntegState>;
  showIntegVersion: (v: string) => void;
  runIdentities: () => Promise<IdState>;
}

const Ctx = createContext<Store | null>(null);

const emptyCrawl: CrawlState = { status: "idle", lab: [], listings: [], total: 0, runnable: 0, counts: {}, page: 0 };
const emptyTrial: TrialState = { status: "idle", events: [], origin: "manual" };
const emptyWatch: WatchState = { status: "idle", versions: [], results: {} };
const emptyInteg: IntegState = { status: "idle", versions: [], events: {}, records: {} };
const emptyIds: IdState = { status: "idle", vendors: [], minted: {}, handoffs: {}, sweeps: [], sightings: [] };
export const STEP_COUNT = 10;

export function LabProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health>();
  const [stats, setStats] = useState<Stats>();
  const [index, setIndex] = useState<TrialRecord[]>([]);
  const [crawlState, setCrawl] = useState<CrawlState>(emptyCrawl);
  const [trial, setTrial] = useState<TrialState>(emptyTrial);
  const [watch, setWatch] = useState<WatchState>(emptyWatch);
  const [gate, setGate] = useState<GateLine[]>([]);
  const [integrations, setIntegrations] = useState<Listing[]>([]);
  const [integ, setInteg] = useState<IntegState>(emptyInteg);
  const [ids, setIds] = useState<IdState>(emptyIds);
  const [pilot, setPilotState] = useState<Pilot>({ running: false, step: 0, total: STEP_COUNT, label: "", done: false });
  const gateId = useRef(0);
  const crawlRef = useRef<CrawlState>(emptyCrawl);

  const setPilot = useCallback((p: Partial<Pilot>) => setPilotState((s) => ({ ...s, ...p })), []);

  const refreshHealth = useCallback(async () => {
    try { const h = await api.getHealth(); setHealth(h); setStats(h.record); } catch { /* lab offline: banner shows it */ }
    try { const r = await api.getIntegrations(); setIntegrations(r.listings); } catch { /* same */ }
  }, []);

  const refreshRecord = useCallback(async () => {
    const r = await api.getRecord();
    setStats(r.stats);
    setIndex(r.index);
  }, []);

  const runCrawl = useCallback(async (pages = 3) => {
    const next: CrawlState = { ...emptyCrawl, status: "crawling" };
    crawlRef.current = next;
    setCrawl(next);
    try {
      const done = await api.crawl(pages, {
        onLab: (lab) => { crawlRef.current = { ...crawlRef.current, lab }; setCrawl(crawlRef.current); },
        onPage: (p) => {
          crawlRef.current = {
            ...crawlRef.current, listings: [...crawlRef.current.listings, ...p.listings],
            total: p.total, runnable: p.runnable, counts: p.counts, page: p.page, lastMs: p.ms,
          };
          setCrawl(crawlRef.current);
        },
      });
      crawlRef.current = { ...crawlRef.current, status: "done", total: done.total, runnable: done.runnable, counts: done.counts };
    } catch (e) {
      crawlRef.current = { ...crawlRef.current, status: "error", error: (e as Error).message };
    }
    setCrawl(crawlRef.current);
    return crawlRef.current;
  }, []);

  const runTrial = useCallback(async (listing: Listing, version?: string, origin: TrialState["origin"] = "manual") => {
    setTrial({ ...emptyTrial, status: "running", listing, version: version ?? listing.version, origin });
    try {
      let record: TrialRecord | undefined;
      await api.runTrialStream(listing.id, version, (e) => {
        if (e.type === "trial") { setTrial((t) => ({ ...t, trialId: e.trialId, version: e.version })); return; }
        if (e.type === "verdict") record = e.record;
        setTrial((t) => ({ ...t, events: [...t.events, e], record: e.type === "verdict" ? e.record : t.record }));
      });
      setTrial((t) => ({ ...t, status: record ? "done" : "error", error: record ? undefined : ([...t.events].reverse().find((e) => e.type === "error") as { message?: string } | undefined)?.message ?? "trial ended without a verdict" }));
      void refreshRecord();
      return record;
    } catch (e) {
      setTrial((t) => ({ ...t, status: "error", error: (e as Error).message }));
      return undefined;
    }
  }, [refreshRecord]);

  const runWatch = useCallback(async (listingId: string) => {
    let state: WatchState = { ...emptyWatch, status: "running", listingId };
    setWatch(state);
    const listing = crawlRef.current.lab.find((l) => l.id === listingId) ?? crawlRef.current.listings.find((l) => l.id === listingId);
    try {
      await api.runWatchStream(listingId, (e) => {
        if (e.type === "trial-event") {
          // Mirror each version's trial into the trial lab so the viewer sees it run.
          const te = e.event;
          setTrial((t) => t.trialId !== e.trialId ? t : ({
            ...t, events: [...t.events, te], record: te.type === "verdict" ? te.record : t.record, status: te.type === "verdict" ? "done" : t.status,
          }));
          return;
        }
        if (e.type === "watch-start") state = { ...state, title: e.title, versions: e.versions };
        if (e.type === "watch-trial") {
          state = { ...state, current: e.version };
          if (listing) setTrial({ ...emptyTrial, status: "running", listing, version: e.version, trialId: e.trialId, origin: "watch" });
        }
        if (e.type === "watch-result") state = { ...state, results: { ...state.results, [e.version]: { verdict: e.verdict, summary: e.summary, trialId: e.trialId } } };
        if (e.type === "watch-done") state = { ...state, status: "done", current: undefined, firstCaught: e.firstCaught };
        if (e.type === "error") state = { ...state, status: "error", error: e.message };
        setWatch(state);
      });
    } catch (e) {
      state = { ...state, status: "error", error: (e as Error).message };
      setWatch(state);
    }
    void refreshRecord();
    return state;
  }, [refreshRecord]);

  const runGate = useCallback(async (listingId: string, version: string | undefined, label: string) => {
    const id = ++gateId.current;
    setGate((g) => [...g, { id, label, listingId, version }]);
    try {
      const result = await api.getGate(listingId, version);
      setGate((g) => g.map((l) => (l.id === id ? { ...l, result } : l)));
      return result;
    } catch (e) {
      setGate((g) => g.map((l) => (l.id === id ? { ...l, error: (e as Error).message } : l)));
      return undefined;
    }
  }, []);

  const clearGate = useCallback(() => setGate([]), []);

  // Same /lab/watch endpoint as the MCP release watch; each version's trial streams into its own slot.
  const runIntegrationWatch = useCallback(async (listingId: string) => {
    let state: IntegState = { ...emptyInteg, status: "running", listingId };
    setInteg(state);
    try {
      await api.runWatchStream(listingId, (e) => {
        if (e.type === "trial-event") {
          const te = e.event;
          setInteg((s) => (state = {
            ...s,
            events: { ...s.events, [e.version]: [...(s.events[e.version] ?? []), te] },
            records: te.type === "verdict" ? { ...s.records, [e.version]: te.record } : s.records,
          }));
          return;
        }
        if (e.type === "watch-start") setInteg((s) => (state = { ...s, versions: e.versions }));
        if (e.type === "watch-trial") setInteg((s) => (state = { ...s, current: e.version, shown: e.version, events: { ...s.events, [e.version]: s.events[e.version] ?? [] } }));
        if (e.type === "watch-done") setInteg((s) => (state = { ...s, status: "done", current: undefined }));
        if (e.type === "error") setInteg((s) => (state = { ...s, status: "error", error: e.message }));
      });
    } catch (e) {
      setInteg((s) => (state = { ...s, status: "error", error: (e as Error).message }));
    }
    void refreshRecord();
    return state;
  }, [refreshRecord]);

  const showIntegVersion = useCallback((v: string) => setInteg((s) => ({ ...s, shown: v })), []);

  const runIdentities = useCallback(async () => {
    let state: IdState = { ...emptyIds, status: "running" };
    setIds(state);
    const apply = (fn: (s: IdState) => IdState) => setIds((s) => (state = fn(s)));
    try {
      await api.runIdentityStream((e: IdentityEvent) => {
        if (e.type === "world") apply((s) => ({ ...s, vendors: e.vendors }));
        if (e.type === "minted") apply((s) => ({ ...s, minted: { ...s.minted, [e.vendor]: e.identity } }));
        if (e.type === "handoff") apply((s) => ({ ...s, handoffs: { ...s.handoffs, [e.vendor]: e.status } }));
        if (e.type === "sweep") apply((s) => ({ ...s, sweeps: [...s.sweeps, { source: e.source, detail: e.detail, bytes: e.bytes }] }));
        if (e.type === "sighting") apply((s) => ({ ...s, sightings: [...s.sightings, e.sighting] }));
        if (e.type === "summary") apply((s) => ({ ...s, status: "done", quiet: e.quiet }));
        if (e.type === "error") apply((s) => ({ ...s, status: "error", error: e.message }));
      });
      if (state.status === "running") apply((s) => ({ ...s, status: "done" }));
    } catch (e) {
      apply((s) => ({ ...s, status: "error", error: (e as Error).message }));
    }
    return state;
  }, []);

  const value = useMemo<Store>(() => ({
    health, stats, index, crawl: crawlState, trial, watch, gate, integrations, integ, ids, pilot,
    setPilot, refreshHealth, refreshRecord, runCrawl, runTrial, runWatch, runGate, clearGate, runIntegrationWatch, showIntegVersion, runIdentities,
  }), [health, stats, index, crawlState, trial, watch, gate, integrations, integ, ids, pilot, setPilot, refreshHealth, refreshRecord, runCrawl, runTrial, runWatch, runGate, clearGate, runIntegrationWatch, showIntegVersion, runIdentities]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLab(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useLab outside LabProvider");
  return s;
}
