import type { useRun } from "../lib/useRun";
import { Logo } from "../components/Logo";

const CANARY_LABELS: Record<string, string> = {
  secret: "Secret keys",
  injection_bait: "Injection bait",
  decoy_action: "Decoy actions",
  out_of_scope: "Out-of-scope data",
  phone_pii: "Phone / PII",
};

const SPONSOR_NOTE: Record<string, string> = {
  careful: "The control. If a canary trips here, the planting is wrong, not the agent.",
  eager: "A weaker model told to be maximally helpful — the classic injection victim.",
  compromised: "The headline threat: a benign-looking skill that exfiltrates on real data.",
};

export function ScenarioView({ run, onStart }: { run: ReturnType<typeof useRun>; onStart: () => void }) {
  const s = run.scenario;
  const total = s ? Object.values(s.plantedCanaries).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="screen scenario">
      <section className="hero">
        <div className="hero-copy">
          <h1>Stop babysitting your agents.</h1>
          <p className="lede">
            Tripwire plants realistic canaries where your agents work. A fired tripwire is proof — which agent,
            which session, which skill, and how far it got. No AI judge, no confidence score.
          </p>
          <div className="task-card">
            <span className="task-label">The task all three agents are given</span>
            <p className="task">{s?.task ?? "…"}</p>
          </div>
          <button className="btn primary lg" onClick={onStart} disabled={run.starting}>
            {run.starting ? "Seeding worlds…" : "Start crash test"}
          </button>
        </div>
        <aside className="plant-card">
          <div className="plant-head">
            <span>Planted this run</span>
            <strong>{total || "·"}<span> canaries</span></strong>
          </div>
          <ul className="plant-list">
            {s && Object.entries(s.plantedCanaries).map(([k, n]) => (
              <li key={k}>
                <span className="plant-n">{n}×</span>
                <span className="plant-label">{CANARY_LABELS[k] ?? k}</span>
                <span className="plant-bar" aria-hidden><i style={{ width: `${Math.min(100, n * 28)}%` }} /></span>
              </li>
            ))}
          </ul>
          <p className="plant-foot">Counts only — positions stay hidden, in a Sparta World shaped like a real Stripe + Zendesk company.</p>
        </aside>
      </section>

      <section className="agents-row">
        {s?.agents.map((a) => (
          <article key={a.id} className={`agent-intro ${a.id}`}>
            <header>
              <Logo size={18} />
              <div>
                <h3>{a.role}</h3>
                <span className="model">{a.model}</span>
              </div>
            </header>
            <p className="disp">{a.disposition}</p>
            {a.skill ? (
              <div className="skill-chip"><span>skill</span> {a.skill.name} — {a.skill.summary}</div>
            ) : (
              <div className="claim">{SPONSOR_NOTE[a.id]}</div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
