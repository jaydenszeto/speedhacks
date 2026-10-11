import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Mono } from "../components/bits";
import type { AgentEvent, Trip } from "../lib/types";

const CHAIN_STAGES: { kinds: string[]; label: string }[] = [
  { kinds: ["canary_exposed"], label: "Exposure" },
  { kinds: ["tool_call", "tool_result"], label: "Handling" },
  { kinds: ["skill_action"], label: "Relay" },
  { kinds: ["trip"], label: "Execution" },
  { kinds: ["breaker", "alert"], label: "Response" },
];

function stageOf(e: AgentEvent): string {
  for (const s of CHAIN_STAGES) if (s.kinds.includes(e.kind)) return s.label;
  return "Handling";
}

export function TripDetail({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const [data, setData] = useState<{ trip: Trip; chain: AgentEvent[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.trip(tripId).then((d) => live && setData(d)).catch((e) => live && setErr(String(e)));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => { live = false; window.removeEventListener("keydown", onKey); };
  }, [tripId, onClose]);

  const t = data?.trip;
  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        {err && <p className="err">{err}</p>}
        {t && (
          <>
            <header className="drawer-head">
              <div className="drawer-id"><Mono>{t.number}</Mono><span className={`sev sev-${t.severity}`}>{t.severity}</span></div>
              <h2>{t.headline}</h2>
            </header>

            <dl className="attr">
              <div><dt>Agent</dt><dd>{t.agentId}</dd></div>
              <div><dt>Attributed to</dt><dd>{t.evidence.actor ?? "model"}</dd></div>
              <div><dt>Detected via</dt><dd>{t.detectedVia.replace(/_/g, " ")}</dd></div>
              <div><dt>Placement</dt><dd>{t.placement ? `${t.placement.kind.replace(/_/g, " ")} · ${t.placement.ref}` : "—"}</dd></div>
              {t.evidence.destination && <div><dt>Destination</dt><dd>{t.evidence.destination}</dd></div>}
              {t.evidence.matched && <div><dt>Matched</dt><dd><Mono>{t.evidence.matched}</Mono>{t.evidence.decoding && t.evidence.decoding !== "raw" ? ` (${t.evidence.decoding}-decoded)` : ""}</dd></div>}
            </dl>

            <h3 className="chain-title">Kill chain — exposure to execution</h3>
            <ol className="chain">
              {data!.chain.map((e) => (
                <li key={e.seq} className={`chain-ev stage-${stageOf(e)} ${e.kind === "trip" ? "is-trip" : ""} ${e.actor.startsWith("skill:") ? "is-skill" : ""}`}>
                  <span className="chain-stage">{stageOf(e)}</span>
                  <span className="chain-seq">{String(e.seq).padStart(3, "0")}</span>
                  <span className="chain-body">
                    {!e.text && e.tool ? <Mono>{e.tool}</Mono> : null} {e.text ?? e.result ?? ""}
                    {e.actor.startsWith("skill:") && <span className="chain-actor">{e.actor}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
        {!t && !err && <p className="loading">Loading replay…</p>}
      </aside>
    </div>
  );
}
