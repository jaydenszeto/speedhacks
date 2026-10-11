import type { useRun } from "../lib/useRun";
import { Stars } from "../components/Stars";
import { Mono } from "../components/bits";
import type { AgentSummary } from "../lib/types";

export function Ratings({ run, onStart, onOpenTrip, onReport }: {
  run: ReturnType<typeof useRun>; onStart: () => void; onOpenTrip: (id: string) => void; onReport: () => void;
}) {
  const agents = (run.status?.agents ?? []).filter((a) => a.rating);
  if (!agents.length) {
    return (
      <div className="screen empty-screen">
        <div className="empty">
          <h2>No ratings yet.</h2>
          <p>Ratings appear once a crash test finishes. Every lost star links to the trip that proves it.</p>
          <button className="btn primary" onClick={onStart} disabled={run.starting}>{run.starting ? "Seeding…" : "Start crash test"}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="screen ratings">
      <div className="ratings-head">
        <div>
          <h1>Crash-test ratings</h1>
          <p className="sub">Evidence-based. No LLM judge — every lost star links to a specific trip and its replay.</p>
        </div>
        <button className="btn" onClick={onReport}>Open Trust Report →</button>
      </div>
      <div className="placards">
        {agents.map((a) => <Placard key={a.spec.id} a={a} onOpenTrip={onOpenTrip} />)}
      </div>
    </div>
  );
}

function Placard({ a, onOpenTrip }: { a: AgentSummary; onOpenTrip: (id: string) => void }) {
  const r = a.rating!;
  return (
    <article className={`placard grade-${r.grade}`}>
      <header className="placard-head">
        <div>
          <span className="role">{a.spec.role}</span>
          <span className="model">{a.spec.model}{a.spec.skill ? ` + ${a.spec.skill.name}` : ""}</span>
        </div>
        <div className="grade-box"><span className="grade">{r.grade}</span></div>
      </header>

      <div className="overall">
        <Stars value={r.overallStars} size={22} />
        <span className="overall-note">{r.overallStars === 5 ? "Clean run" : r.worstSeverity === "critical" ? "Critical leak" : "Failed a category"}</span>
      </div>

      <ul className="cat-list">
        {r.categories.map((c) => (
          <li key={c.key} className={c.stars < 5 ? "lost" : ""}>
            <div className="cat-top">
              <span className="cat-label">{c.label}</span>
              <Stars value={c.stars} size={13} />
            </div>
            {c.trips.length > 0 && (
              <div className="cat-proof">
                {c.trips.map((t) => (
                  <button key={t.tripId} className="proof-link" onClick={() => onOpenTrip(t.tripId)}>
                    <Mono>{t.number}</Mono> {t.headline}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      <footer className="placard-foot">
        <div className="util">
          <span className="util-k">Task utility</span>
          <span className="util-v">{r.utility.percent}%</span>
          <span className="util-sub">{r.utility.correct}/{r.utility.total} tickets resolved correctly · verified by Sparta</span>
        </div>
      </footer>
    </article>
  );
}
