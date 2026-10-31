import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useLab } from "../store";
import type { BaitItem, Finding, LabEvent } from "../types";
import { EASE_OUT, Section, ms, scrollToId } from "./ui";

type Ev<T extends LabEvent["type"]> = Extract<LabEvent, { type: T }>;

/** Bait items an unexpected finding touched. Env bait carries the same minted value as its canary, so it's taken too. */
export function takenBait(bait: BaitItem[], findings: Finding[]): Set<string> {
  const ids = new Set(findings.filter((f) => !f.expected).map((f) => f.canaryId));
  const previews = new Set(bait.filter((b) => ids.has(b.id)).map((b) => b.preview));
  return new Set(bait.filter((b) => ids.has(b.id) || (b.kind === "env" && previews.has(b.preview))).map((b) => b.id));
}

export function TrialLab() {
  const { trial, crawl, runTrial } = useLab();
  const { events, record } = trial;

  // Stamp each event with when it arrived, so the log reads as a real timeline.
  const stamps = useRef<{ id?: string; t0: number; at: number[] }>({ t0: 0, at: [] });
  if (stamps.current.id !== trial.trialId || events.length < stamps.current.at.length) stamps.current = { id: trial.trialId, t0: Date.now(), at: [] };
  while (stamps.current.at.length < events.length) stamps.current.at.push(Date.now() - stamps.current.t0);

  const bait = (events.find((e) => e.type === "bait") as Ev<"bait"> | undefined)?.items ?? [];
  const egress = events.filter((e): e is Ev<"egress"> => e.type === "egress");
  const findings = record?.findings ?? events.filter((e): e is Ev<"finding"> => e.type === "finding").map((e) => e.finding);
  const taken = useMemo(() => takenBait(bait, findings), [bait, findings]);
  const runner = (events.find((e) => e.type === "spawn") as Ev<"spawn"> | undefined)?.runner ?? (trial.listing?.kind === "lab" ? "local" : trial.listing ? "sandbox" : undefined);
  const tools = (events.find((e) => e.type === "tools") as Ev<"tools"> | undefined)?.names ?? [];
  const probesDone = events.filter((e) => e.type === "probe-done").length;

  const logRef = useRef<HTMLDivElement>(null);
  const egRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const el of [logRef.current, egRef.current]) if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  const lab = crawl.lab;
  const quick = (id: string, version?: string) => {
    const l = lab.find((x) => x.id === id);
    if (l) void runTrial(l, version);
  };

  if (trial.status === "idle") {
    return (
      <Section id="trial" num="02" title="Put it on trial" cap="Pick any runnable listing above, or start with one of the lab's planted cases.">
        <div className="panel empty" style={{ display: "grid", gap: 16, justifyItems: "center", padding: "72px 16px" }}>
          <div className="mono-xs">Nothing on trial yet</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <button className="btn btn--sm" disabled={!lab.length} onClick={() => quick("lab/mailer-mcp", "1.0.16")}>mailer-mcp v1.0.16 · planted</button>
            <button className="btn btn--sm btn--ghost" disabled={!lab.length} onClick={() => quick("lab/safe-notes")}>safe-notes · control</button>
            <button className="btn btn--sm btn--ghost" onClick={() => scrollToId("market")}>Browse the registry ↑</button>
          </div>
        </div>
      </Section>
    );
  }

  const l = trial.listing;
  return (
    <Section
      id="trial" num="02" title="Put it on trial"
      cap="Mole fills the server's world with fake secrets it minted itself, calls every tool it exposes, and watches every byte that tries to leave."
      aside={trial.origin === "watch" ? <span className="chip">driven by release watch</span> : undefined}
    >
      <div className="trial__top">
        <div>
          <div className="trial__name">{l?.title || l?.name}</div>
          <div className="trial__meta">
            <span className="chip">{l?.name}</span>
            <span className="chip">v{trial.version}</span>
            {runner === "sandbox" && <span className="chip chip--lab">sandbox · docker · network none</span>}
            {runner === "local" && <span className="chip chip--lab">lab · planted case · local</span>}
            {tools.length > 0 && <span className="chip">{tools.length} tools</span>}
          </div>
        </div>
        <div className="mono-xs dim" aria-live="polite">
          {trial.status === "running" ? <><span className="dot dot--on" /> &nbsp;live · {ms(stamps.current.at.at(-1))}</> : record ? `finished in ${ms(record.durationMs)}` : trial.error}
        </div>
      </div>

      <div className="trial__grid">
        <div className="panel">
          <div className="panel__h"><b>Bait planted</b><span>{bait.length} items</span></div>
          <ul className="bait">
            <AnimatePresence>
              {bait.map((b, i) => (
                <motion.li
                  key={b.id} className={taken.has(b.id) ? "taken" : undefined}
                  initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05, duration: 0.5, ease: EASE_OUT }}
                >
                  <span className="bait__label">{b.label}</span>
                  <span className="bait__where">{b.where === "server environment" ? "env" : "args"}</span>
                  <span className="bait__val">{b.preview}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          {!bait.length && <div className="egress__quiet">minting bait…</div>}
        </div>

        <div className="panel">
          <div className="panel__h"><b>Probe log</b><span>{probesDone}/{tools.length || "?"} tools called</span></div>
          <div className="log" ref={logRef} role="log" aria-live="off">
            {events.map((e, i) => <LogRow key={i} e={e} t={stamps.current.at[i] ?? 0} />)}
            {trial.status === "running" && <div className="log__row log__row--muted"><span className="log__t" /><span className="log__m"><span className="cursor" /></span></div>}
          </div>
        </div>

        <div className="panel">
          <div className="panel__h"><b>Outbound attempts</b><span>{egress.length} seen</span></div>
          <div className="egress" ref={egRef}>
            {egress.length === 0 ? (
              <div className="egress__quiet"><strong>0</strong>{trial.status === "running" ? "nothing has tried to leave yet" : "nothing tried to leave"}</div>
            ) : (
              egress.map((e, i) => (
                <motion.div
                  key={i} className={`egress__row${e.bait ? " egress__row--bait" : ""}`}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE_OUT }}
                >
                  <span className="mono-xs faint">{e.method} · {e.scheme} · from {e.tool}{e.bait && <span className="tag"> · carries bait</span>}</span>
                  <b>{e.host}</b>
                  <span className="faint" style={{ overflowWrap: "anywhere" }}>{e.target} · {e.bytes} bytes</span>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>

      <VerdictBlock taken={new Set(findings.filter((f) => !f.expected).map((f) => f.canaryId)).size} toolCount={tools.length} probes={probesDone} egress={egress.length} />
    </Section>
  );
}

function LogRow({ e, t }: { e: LabEvent; t: number }) {
  const time = <span className="log__t">{(t / 1000).toFixed(2)}s</span>;
  const row = (cls: string, m: ReactNode) => <div className={`log__row ${cls}`}>{time}<span className="log__m">{m}</span></div>;
  switch (e.type) {
    case "stage": return row("log__row--stage", e.text);
    case "log": return row("log__row--muted", e.text);
    case "bait": return row("", `minted ${e.items.length} bait items`);
    case "spawn": return row("log__row--muted", `spawn ${e.runner}: ${e.command.slice(0, 140)}`);
    case "source": return row("", `read source: ${e.files} files · ${e.lines.toLocaleString()} lines`);
    case "connected": return row("", `MCP handshake ok in ${ms(e.ms)}`);
    case "tools": return row("", `tools exposed: ${e.names.join(", ") || "none"}`);
    case "probe": return row("log__row--probe", <><b>call {e.tool}</b><span className="log__args">{e.args}</span></>);
    case "probe-done": return row("log__row--muted", `${e.tool} returned ${e.outcome} · ${ms(e.ms)}`);
    case "egress": return row(e.bait ? "leak" : "", `${e.tool} → ${e.method} ${e.host}${e.bait ? " · BAIT IN PAYLOAD" : ""}`);
    case "finding": return e.finding.expected ? row("", `${e.finding.canaryLabel} went to ${e.finding.destination} (its own declared service)`) : row("leak", `LEAK · ${e.finding.canaryLabel} → ${e.finding.destination}`);
    case "error": return row("", `error: ${e.message}`);
    case "done": return row("log__row--muted", "scan complete");
    case "verdict": return null;
  }
}

function VerdictBlock({ taken, toolCount, probes, egress }: { taken: number; toolCount: number; probes: number; egress: number }) {
  const { trial } = useLab();
  const r = trial.record;
  const verdict = trial.status === "running" ? "running" : r?.verdict ?? "inconclusive";
  return (
    <div className={`verdict${verdict === "caught" ? " verdict--caught" : ""}`} aria-live="polite">
      <AnimatePresence mode="wait">
        <motion.div
          key={verdict + (r?.id ?? "")}
          className={`stamp stamp--${verdict}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
        >
          {verdict === "running" ? "On trial…" : verdict}
        </motion.div>
      </AnimatePresence>
      <div className="verdict__facts">
        <Fact n={r?.toolsFound ?? toolCount} l="tools found" />
        <Fact n={r?.probes ?? probes} l="probes" />
        <Fact n={r?.egress ?? egress} l="outbound attempts" />
        <Fact n={taken} l="bait items taken" leak={taken > 0} />
        <div className="verdict__sum">
          {trial.status === "running" ? "Verdict lands when every tool has been called." : r?.summary ?? trial.error}
          {r?.verdict === "caught" && <> · <a href="#evidence" onClick={(e) => { e.preventDefault(); scrollToId("evidence"); }}>see the evidence ↓</a></>}
        </div>
      </div>
    </div>
  );
}

function Fact({ n, l, leak }: { n: number; l: string; leak?: boolean }) {
  return <div><div className={`fact__n${leak ? " leak" : ""}`}>{n}</div><div className="fact__l">{l}</div></div>;
}
