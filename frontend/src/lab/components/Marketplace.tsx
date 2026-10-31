import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, type FormEvent } from "react";
import * as api from "../api";
import { useLab } from "../store";
import type { Listing, TrialRecord } from "../types";
import { Counter, Section, VerdictChip, ms, scrollToId } from "./ui";

type Filter = "all" | "runnable" | "lab";
const KIND_ORDER = ["npm", "remote", "pypi", "oci", "other"];

export function Marketplace() {
  const { crawl, runCrawl, runTrial, trial, index, pilot } = useLab();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Listing[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string>();

  const latest = useMemo(() => {
    const m = new Map<string, TrialRecord>();
    for (const r of index) { const cur = m.get(r.listingId); if (!cur || cur.startedAt < r.startedAt) m.set(r.listingId, r); }
    return m;
  }, [index]);

  const shown = useMemo(() => {
    const seen = new Set<string>();
    const all = [...crawl.lab, ...found, ...crawl.listings].filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
    const needle = q.trim().toLowerCase();
    return all.filter((l) => {
      if (filter === "runnable" && !l.runnable) return false;
      if (filter === "lab" && l.kind !== "lab") return false;
      if (needle && !`${l.name} ${l.title} ${l.description}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [crawl.lab, crawl.listings, found, filter, q]);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setSearching(true); setSearchErr(undefined);
    try { setFound((await api.searchRegistry(q.trim())).listings); } catch (err) { setSearchErr((err as Error).message); }
    setSearching(false);
  };

  const open = (l: Listing) => {
    if (!l.runnable || trial.status === "running") return;
    scrollToId("trial");
    void runTrial(l);
  };

  const crawling = crawl.status === "crawling";
  const total = crawl.total;
  const kinds = KIND_ORDER.filter((k) => crawl.counts[k]);

  return (
    <Section
      id="market" num="01" title="Read the marketplace"
      cap="Live from the official MCP Registry. Every listing is parsed for how it installs. Mole can run npm packages over stdio right now; remote endpoints are listed but not executed."
      aside={
        <button className="btn" onClick={() => void runCrawl(3)} disabled={crawling || pilot.running}>
          {crawling ? `Crawling page ${crawl.page + 1}…` : crawl.status === "done" ? "Crawl again" : "Crawl the registry"}
        </button>
      }
    >
      <div className="mk__meter" aria-live="polite">
        <div><Counter value={crawl.page} className="stat__n" /><div className="stat__l">Pages read</div></div>
        <div><Counter value={total} className="stat__n" /><div className="stat__l">Listings parsed</div></div>
        <div><Counter value={crawl.runnable} className="stat__n" /><div className="stat__l">Runnable here</div></div>
        <div><span className="stat__n">{ms(crawl.lastMs)}</span><div className="stat__l">Last page</div></div>
        <div>
          <div className="stat__l">How they install</div>
          <div className="mk__bar" aria-hidden="true">
            {kinds.map((k) => <span key={k} style={{ flexGrow: crawl.counts[k] }} />)}
          </div>
          <div className="mono-xs faint" style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap" }}>
            {kinds.length ? kinds.map((k) => <span key={k}>{k} {crawl.counts[k]}</span>) : <span>no pages read yet</span>}
          </div>
        </div>
      </div>

      <div className="mk__tools">
        <div className="seg" role="group" aria-label="Filter listings">
          {(["all", "runnable", "lab"] as const).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        <form className="search" onSubmit={search} role="search">
          <label htmlFor="mk-q" className="sr">Search listings</label>
          <input id="mk-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter, or press Enter to search the whole registry" />
          <button className="btn btn--sm btn--ghost" style={{ border: 0, borderLeft: "1px solid var(--line)" }} disabled={searching}>
            {searching ? "…" : "Search"}
          </button>
        </form>
        <span className="mono-xs faint">{shown.length} shown{searchErr ? ` · search failed: ${searchErr}` : ""}</span>
      </div>

      <div className="grid" aria-busy={crawling}>
        {crawling && <div className="grid__beam" aria-hidden="true" />}
        {shown.length === 0 && (
          <div className="empty" style={{ gridColumn: "1 / -1", background: "var(--void)" }}>
            {crawl.status === "error" ? `Crawl failed: ${crawl.error}` : crawling ? "Reading the registry…" : "Nothing here yet. Crawl the registry to fill the shelf."}
          </div>
        )}
        <AnimatePresence initial={false}>
          {shown.slice(0, 240).map((l, i) => {
            const rec = latest.get(l.id);
            const live = trial.status === "running" && trial.listing?.id === l.id;
            return (
              <motion.button
                layout="position"
                key={l.id}
                className={`card${l.kind === "lab" ? " card--lab" : ""}${live ? " card--focus" : ""}${rec?.verdict === "caught" ? " card--caught" : ""}`}
                onClick={() => open(l)}
                disabled={!l.runnable}
                title={l.runnable ? `Put ${l.name} on trial` : l.runnableNote}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: Math.min(i, 30) * 0.012 }}
              >
                <div className="card__top">
                  <span className={`chip${l.kind === "lab" ? " chip--lab" : ""}`}>
                    {l.kind === "lab" ? "lab · planted" : l.kind}
                  </span>
                  <VerdictChip verdict={live ? "running" : rec?.verdict} />
                </div>
                <div className="card__title">{l.title || l.name.split("/").pop()}</div>
                <div className="card__name">{l.name} · v{l.version}</div>
                <div className="card__desc">{l.description}</div>
                <div className="card__foot">
                  <span>{l.runnable ? (l.kind === "lab" ? "runs locally" : "sandbox · no network") : l.runnableNote}</span>
                  {l.runnable && <span className="card__run">Trial →</span>}
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </Section>
  );
}
