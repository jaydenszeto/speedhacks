/**
 * One store for the whole demo. Every action is a real call to the lab server and returns a promise that settles when
 * the real work finishes. That's what lets the autopilot simply `await` each step instead of faking timings.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import * as api from "./api";
import type { GateResult, Health, LabEvent, Listing, Stats, TrialRecord, Verdict } from "./types";

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
  pilot: Pilot;
  setPilot: (p: Partial<Pilot>) => void;
  refreshHealth: () => Promise<void>;
  refreshRecord: () => Promise<void>;
  runCrawl: (pages?: number) => Promise<CrawlState>;
  runTrial: (listing: Listing, version?: string, origin?: TrialState["origin"]) => Promise<TrialRecord | undefined>;
  runWatch: (listingId: string) => Promise<WatchState>;
  runGate: (listingId: string, version: string | undefined, label: string) => Promise<GateResult | undefined>;
  clearGate: () => void;
}

const Ctx = createContext<Store | null>(null);

const emptyCrawl: CrawlState = { status: "idle", lab: [], listings: [], total: 0, runnable: 0, counts: {}, page: 0 };
const emptyTrial: TrialState = { status: "idle", events: [], origin: "manual" };
const emptyWatch: WatchState = { status: "idle", versions: [], results: {} };

export function LabProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health>();
  const [stats, setStats] = useState<Stats>();
  const [index, setIndex] = useState<TrialRecord[]>([]);
  const [crawlState, setCrawl] = useState<CrawlState>(emptyCrawl);
  const [trial, setTrial] = useState<TrialState>(emptyTrial);
  const [watch, setWatch] = useState<WatchState>(emptyWatch);
  const [gate, setGate] = useState<GateLine[]>([]);
  const [pilot, setPilotState] = useState<Pilot>({ running: false, step: 0, total: 7, label: "", done: false });
  const gateId = useRef(0);
  const crawlRef = useRef<CrawlState>(emptyCrawl);

  const setPilot = useCallback((p: Partial<Pilot>) => setPilotState((s) => ({ ...s, ...p })), []);

  const refreshHealth = useCallback(async () => {
    try { const h = await api.getHealth(); setHealth(h); setStats(h.record); } catch { /* lab offline: banner shows it */ }
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
      const { trialId, version: v } = await api.startTrial(listing.id, version);
      setTrial((t) => ({ ...t, trialId, version: v }));
      let record: TrialRecord | undefined;
      await api.followTrial(trialId, (e) => {
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
      const { watchId } = await api.startWatch(listingId);
      const trialFollows: Promise<void>[] = [];
      await api.followWatch(watchId, (e) => {
        if (e.type === "watch-start") state = { ...state, title: e.title, versions: e.versions };
        if (e.type === "watch-trial") {
          state = { ...state, current: e.version };
          // Mirror each version's trial into the trial lab so the viewer sees it run.
          if (listing) {
            setTrial({ ...emptyTrial, status: "running", listing, version: e.version, trialId: e.trialId, origin: "watch" });
            trialFollows.push(api.followTrial(e.trialId, (te) => setTrial((t) => t.trialId !== e.trialId ? t : ({
              ...t, events: [...t.events, te], record: te.type === "verdict" ? te.record : t.record, status: te.type === "verdict" ? "done" : t.status,
            }))).catch(() => undefined));
          }
        }
        if (e.type === "watch-result") state = { ...state, results: { ...state.results, [e.version]: { verdict: e.verdict, summary: e.summary, trialId: e.trialId } } };
        if (e.type === "watch-done") state = { ...state, status: "done", current: undefined, firstCaught: e.firstCaught };
        if (e.type === "error") state = { ...state, status: "error", error: e.message };
        setWatch(state);
      });
      await Promise.all(trialFollows);
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

  const value = useMemo<Store>(() => ({
    health, stats, index, crawl: crawlState, trial, watch, gate, pilot,
    setPilot, refreshHealth, refreshRecord, runCrawl, runTrial, runWatch, runGate, clearGate,
  }), [health, stats, index, crawlState, trial, watch, gate, pilot, setPilot, refreshHealth, refreshRecord, runCrawl, runTrial, runWatch, runGate, clearGate]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLab(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useLab outside LabProvider");
  return s;
}
