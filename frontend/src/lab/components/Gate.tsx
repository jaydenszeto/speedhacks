import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { useLab } from "../store";
import { EASE_OUT, Section } from "./ui";

export interface GateAsk { listingId: string; version?: string; label: string; note: string }

/** The asks the gate panel offers: the release-watch pair, the latest registry trial, and something never tested. */
export function useGateAsks(): GateAsk[] {
  const { index, crawl } = useLab();
  return useMemo(() => {
    const asks: GateAsk[] = [
      { listingId: "lab/mailer-mcp", version: "1.0.15", label: "lab/mailer-mcp@1.0.15", note: "last clean release" },
      { listingId: "lab/mailer-mcp", version: "1.0.16", label: "lab/mailer-mcp@1.0.16", note: "the release that leaks" },
    ];
    const reg = [...index].filter((r) => !r.lab).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (reg) asks.push({ listingId: reg.listingId, version: reg.version, label: `${reg.listingId}@${reg.version}`, note: "registry, tested here" });
    const tested = new Set(index.map((r) => r.listingId));
    const fresh = crawl.listings.find((l) => !tested.has(l.id));
    if (fresh) asks.push({ listingId: fresh.id, version: fresh.version, label: `${fresh.id}@${fresh.version}`, note: "registry, never tested" });
    return asks;
  }, [index, crawl.listings]);
}

export function Gate() {
  const { gate, runGate, clearGate } = useLab();
  const asks = useGateAsks();
  const termRef = useRef<HTMLDivElement>(null);
  useEffect(() => { termRef.current?.scrollTo({ top: termRef.current.scrollHeight, behavior: "smooth" }); }, [gate]);

  return (
    <Section
      id="gate" num="06" title="Gate the install"
      cap="Before an agent installs a tool, it asks Mole. Cleared for this exact version: allow. Caught: block. Never tested: hold and queue a trial. No vibes, only the record."
      aside={gate.length > 0 && <button className="btn btn--sm btn--ghost" onClick={clearGate}>Clear</button>}
    >
      <div className="gate">
        <div className="panel">
          <div className="panel__h"><b>agent session</b><span>GET /lab/gate</span></div>
          <div className="term" ref={termRef} role="log" aria-live="polite">
            <span className="term__line term__p"># an agent is about to install tools. each install goes through the gate first.</span>
            <AnimatePresence initial={false}>
              {gate.map((g) => (
                <motion.div key={g.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE_OUT }}>
                  <span className="term__line"><span className="term__p">agent ▸</span> install {g.label}</span>
                  {g.result ? (
                    <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
                      <span className={`term__res term__res--${g.result.decision}`}>
                        {g.result.decision === "allow" ? "✓ ALLOW" : g.result.decision === "block" ? "✕ BLOCK" : "… HOLD"}
                      </span>
                      <span className="term__why">{g.result.reason}{g.result.trialId ? ` · ${g.result.trialId}` : ""}</span>
                    </motion.span>
                  ) : g.error ? (
                    <span className="term__why">error: {g.error}</span>
                  ) : (
                    <span className="term__res term__res--hold">asking mole…</span>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            <span className="term__line"><span className="term__p">agent ▸</span> <span className="cursor" /></span>
          </div>
        </div>
        <div className="panel">
          <div className="panel__h"><b>Try an install</b><span>real API calls</span></div>
          <div className="gate__try">
            {asks.map((a) => (
              <button key={a.label} className="btn btn--sm btn--ghost" onClick={() => void runGate(a.listingId, a.version, a.label)}>
                <span>{a.label}</span>
                <span className="faint">{a.note}</span>
              </button>
            ))}
            <pre className="snippet">{`curl "${typeof window === "undefined" ? "" : window.location.origin}/lab/gate?id=lab/mailer-mcp&version=1.0.16"`}</pre>
          </div>
        </div>
      </div>
    </Section>
  );
}
