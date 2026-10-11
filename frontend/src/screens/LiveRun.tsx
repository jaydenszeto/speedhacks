import { useEffect, useMemo, useRef } from "react";
import type { useRun } from "../lib/useRun";
import { eventsByAgent } from "../lib/useRun";
import { Pill, Mono } from "../components/bits";
import type { AgentEvent } from "../lib/types";

const ROLES: { id: string; role: string; model: string }[] = [
  { id: "careful", role: "Careful", model: "claude-opus-5-5" },
  { id: "eager", role: "Eager", model: "claude-haiku-5-5" },
  { id: "compromised", role: "Compromised", model: "claude-opus-5-5 + skill" },
];

function StepFeed({ events }: { events: AgentEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }); }, [events.length]);
  const steps = events.filter((e) => ["tool_call", "canary_exposed", "trip", "breaker", "agent_finished"].includes(e.kind));
  return (
    <div className="feed" ref={ref}>
      {steps.map((e) => (
        <div key={e.seq} className={`ev ev-${e.kind} ${e.actor.startsWith("skill:") ? "ev-skill" : ""}`}>
          <span className="ev-seq">{String(e.seq).padStart(3, "0")}</span>
          <span className="ev-body">
            {e.kind === "tool_call" && <><Mono>{e.tool}</Mono>{renderArgs(e)}</>}
            {e.kind === "canary_exposed" && <span className="ev-exp">exposed canary</span>}
            {e.kind === "trip" && <span className="ev-trip">⚑ {e.text}</span>}
            {e.kind === "breaker" && <span className="ev-breaker">breaker thrown · credentials revoked</span>}
            {e.kind === "agent_finished" && <span className="ev-fin">finished</span>}
            {e.actor.startsWith("skill:") && <span className="ev-actor">{e.actor}</span>}
          </span>
        </div>
      ))}
      {steps.length === 0 && <div className="feed-empty">waiting for first step…</div>}
    </div>
  );
}

function renderArgs(e: AgentEvent): string {
  const a = e.args ?? {};
  if (e.tool === "zendesk_get_ticket") return ` #${a.id}`;
  if (e.tool === "read_file") return ` ${a.path}`;
  if (e.tool === "stripe_create_refund") return ` ${a.charge} $${((Number(a.amount) || 0) / 100).toFixed(2)}`;
  if (e.tool === "place_call") return ` → ${a.to}`;
  if (e.tool === "send_email") return ` → ${a.to}`;
  if (e.tool === "zendesk_reply") return ` #${a.id}`;
  if (e.tool === "zendesk_escalate") return ` #${a.id}`;
  return "";
}

export function LiveRun({ run, onStart, onOpenTrip, onSeeRatings }: {
  run: ReturnType<typeof useRun>; onStart: () => void; onOpenTrip: (id: string) => void; onSeeRatings: () => void;
}) {
  const byAgent = useMemo(() => eventsByAgent(run.events), [run.events]);
  const trips = run.status?.trips ?? [];
  const breaker = (id: string) => run.status?.agents.find((a) => a.spec.id === id)?.breaker;

  if (run.phase === "idle" && run.events.length === 0) {
    return (
      <div className="screen empty-screen">
        <div className="empty">
          <h2>Nothing running.</h2>
          <p>Start a crash test to watch three agents work the same tickets, live.</p>
          <button className="btn primary" onClick={onStart} disabled={run.starting}>{run.starting ? "Seeding…" : "Start crash test"}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen live">
      <div className="live-head">
        <div>
          <h1>Live run</h1>
          <p className="sub">{run.status?.events ?? run.events.length} events observed · <strong>0</strong> you had to read</p>
        </div>
        <div className="live-actions">
          {run.done && <button className="btn" onClick={onSeeRatings}>See ratings →</button>}
          {run.done && <button className="btn ghost" onClick={onStart}>Run again</button>}
        </div>
      </div>

      <div className="lanes">
        {ROLES.map((r) => {
          const b = breaker(r.id);
          const paused = b?.state === "thrown";
          const finished = byAgent[r.id]?.some((e) => e.kind === "agent_finished");
          const tone = paused ? "paused" : finished ? "done" : "live";
          return (
            <section key={r.id} className={`lane ${paused ? "lane-tripped" : ""}`}>
              <header className="lane-head">
                <span className={`lane-line ${paused ? "cut" : finished ? "done" : "live"}`} aria-hidden />
                <div className="lane-id">
                  <h2>{r.role}</h2>
                  <span className="model">{r.model}</span>
                </div>
                <Pill tone={tone}>{paused ? "Paused" : finished ? "Done" : "Running"}</Pill>
              </header>
              <StepFeed events={byAgent[r.id] ?? []} />
            </section>
          );
        })}
      </div>

      <aside className={`tripwire-panel ${trips.length ? "has-trips" : ""}`}>
        <header><h2>Tripwires</h2><span className="count">{trips.length}</span></header>
        {trips.length === 0 ? (
          <div className="panel-calm">
            <p>No trips. Nothing to review.</p>
            <span>This is what trust looks like — calm until something fires.</span>
          </div>
        ) : (
          <ul className="trip-list">
            {trips.map((t) => (
              <li key={t.tripId} className={`trip-row sev-row-${t.severity}`}>
                <button onClick={() => onOpenTrip(t.tripId)}>
                  <div className="trip-top">
                    <Mono>{t.number}</Mono>
                    <span className={`sev sev-${t.severity}`}>{t.severity}</span>
                  </div>
                  <p className="trip-headline">{t.headline}</p>
                  <div className="trip-meta">
                    <span className="who">{ROLES.find((r) => r.id === t.agentId)?.role}</span>
                    <span className="via">{t.detectedVia.replace(/_/g, " ")}</span>
                    {t.evidence.actor?.startsWith("skill:") && <span className="actor">{t.evidence.actor}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {run.status?.alert && (
          <div className="alert-card">
            <span className="alert-k">Dial {run.status.alert.mode} alert</span>
            <p>“{run.status.alert.script}”</p>
            <span className="alert-to">→ {run.status.alert.to} · {run.status.alert.status}</span>
          </div>
        )}
      </aside>
    </div>
  );
}
