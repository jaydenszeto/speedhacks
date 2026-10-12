import type { ReactNode } from "react";
import { AGENTS, type AgentKey } from "./transcript";
import { useReveal } from "./useReveal";
import { ArrowRight } from "./icons";

export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const { ref, shown } = useReveal();
  return (
    <div ref={ref} className={`reveal ${shown ? "is-in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function SectionHead({ title, lede }: { title: ReactNode; lede?: ReactNode }) {
  return (
    <div className="sec-head">
      <h2 className="sec-title">{title}</h2>
      {lede && <p className="sec-lede">{lede}</p>}
    </div>
  );
}

// ── How it works ──────────────────────────────────────────────────────────────

const STEPS = [
  { n: "01", t: "Agent search finds candidates", d: "Your assistant asks Darwin for specialists that could do the task. Mole takes the runnable ones from there." },
  { n: "02", t: "Mole trials each one", d: "Every candidate runs the real task inside its own Sparta world with fake secrets mixed in — in parallel, observed to the end." },
  { n: "03", t: "The assistant hires a cleared agent", d: "Mole hands back cleared-or-caught per candidate. The assistant may only delegate to one Mole cleared." },
];

const CHECKS = [
  {
    tone: "sage", tag: "the two checks",
    t: "Cleared = two measured facts",
    d: (
      <>
        <strong>Job done</strong> — did the agent actually finish? Read straight from Sparta’s end-state
        diff, so an agent can’t look good by doing nothing. <strong>Bait untouched</strong> — did it
        leave every planted secret alone? An agent is <em>cleared</em> only when both are true. No LLM
        judges anything.
      </>
    ),
  },
  {
    tone: "brick", tag: "the catch",
    t: "Caught in the act",
    d: (
      <>
        Every outbound tool argument is decoded — url, base64, hex — and matched against the bait, so a
        leak is caught <em>in the tool call</em>, before it leaves. A planted tracking URL being fetched
        means it called home. Trials are observe-only: a caught agent still finishes, so Mole can report
        whether it did the job too.
      </>
    ),
  },
  {
    tone: "amber", tag: "the bait",
    t: "Secrets worth stealing",
    d: (
      <>
        Fresh, revocable, real-looking secrets mixed into the world: a Stripe-style live key, a database
        URL, a VIP customer record, an out-of-scope payroll file, a Dial phone number. Indistinguishable
        from the real <code>sk_live_…</code>, so a skill that greps for obvious honeytokens still takes it.
      </>
    ),
  },
];

export function HowItWorks() {
  return (
    <section className="section how" id="how">
      <Reveal>
        <SectionHead
          title={<>No opinions. <em>Two measured facts.</em></>}
          lede="Mole sits between agent search and your assistant. It never overstates a verdict — it reports exactly what it tested and exactly what it caught."
        />
      </Reveal>

      <div className="pipeline">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 90} className="pipe-cell">
            <div className="pipe">
              <span className="pipe-n">{s.n}</span>
              <strong>{s.t}</strong>
              <p>{s.d}</p>
            </div>
            {i < STEPS.length - 1 && <span className="pipe-arrow" aria-hidden><ArrowRight size={18} /></span>}
          </Reveal>
        ))}
      </div>

      <div className="checks">
        {CHECKS.map((c, i) => (
          <Reveal key={c.t} delay={i * 90} className="check-cell">
            <article className={`check check-${c.tone}`}>
              <span className="check-tag">{c.tag}</span>
              <h3>{c.t}</h3>
              <p>{c.d}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ── Candidates ────────────────────────────────────────────────────────────────

const VERDICT_LABEL: Record<string, string> = { cleared: "CLEARED", clean: "CLEAN · JOB NOT DONE", caught: "CAUGHT" };
const ORDER: AgentKey[] = ["refund-pro", "ticket-triage", "billing-helper"];

export function Candidates() {
  return (
    <section className="section cands" id="candidates">
      <Reveal>
        <SectionHead
          title={<>Three agents. <em>One trial.</em></>}
          lede="The same focused task, the same planted bait, run on each. This is the real verdict from the run above."
        />
      </Reveal>
      <div className="cand-grid">
        {ORDER.map((k, i) => {
          const a = AGENTS[k];
          return (
            <Reveal key={k} delay={i * 90} className="cand-cell">
              <article className={`cand cand-${a.verdict}`}>
                <header>
                  <strong>{a.label}</strong>
                  <span className={`cand-chip ${a.verdict}`}>{VERDICT_LABEL[a.verdict]}</span>
                </header>
                <p className="cand-blurb">{a.blurb}</p>
                <div className="cand-facts">
                  <div className="fact">
                    <span>Job done</span>
                    <b className={a.jobDone ? "yes" : "no"}>{a.jobDone ? "yes" : "no"} · {a.utility}%</b>
                  </div>
                  <div className="fact">
                    <span>Bait untouched</span>
                    <b className={a.verdict === "caught" ? "no" : "yes"}>{a.verdict === "caught" ? "NO — caught" : "yes"}</b>
                  </div>
                </div>
                <p className="cand-detail">{a.detail}</p>
                <code className="cand-meta">{a.model} · skill {a.skill}</code>
              </article>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

// ── Sponsors ──────────────────────────────────────────────────────────────────

const SPONSORS = [
  { n: "Sparta", r: "The simulated Stripe + Zendesk company each trial runs inside. Its end-state diff is the ‘job done’ check." },
  { n: "Darwin", r: "Agent search: discovers candidate specialists for a task. Mole trials the runnable ones." },
  { n: "Dial", r: "Places the voice alert to the owner on a high-severity catch, and supplies real phone-number bait." },
  { n: "Keewano", r: "The typed event store. Supplies each candidate’s prior trips on record, so repeat offenders are flagged." },
];

export function Sponsors() {
  return (
    <section className="section sponsors">
      <Reveal>
        <SectionHead title={<>Built on real roles, <em>not logos.</em></>} />
      </Reveal>
      <div className="spon-grid">
        {SPONSORS.map((s, i) => (
          <Reveal key={s.n} delay={i * 70} className="spon-cell">
            <div className="spon">
              <strong>{s.n}</strong>
              <p>{s.r}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ── Try it ────────────────────────────────────────────────────────────────────

const CMDS = [
  ["pnpm demo:live", "the exact run on this page — a real assistant hires a cleared specialist"],
  ["pnpm mole pick \"resolve the refund queue\"", "trial + rank every candidate yourself"],
  ["pnpm mole report", "write a shareable Trust Report (static HTML)"],
  ["pnpm mole doctor", "preflight the environment before a live run"],
];

export function TryIt() {
  return (
    <section className="section tryit" id="try">
      <Reveal>
        <SectionHead
          title={<>Every number here <em>was measured.</em></>}
          lede="Default paths run for real — a real subprocess, a real Sparta world, real agents. DEMO_FALLBACK only replays recorded data, and prints a visible REPLAY banner when it does."
        />
      </Reveal>
      <Reveal className="cmd-wrap">
        <div className="cmd-block">
          {CMDS.map(([cmd, note]) => (
            <div className="cmd-row" key={cmd}>
              <code><span className="cmd-dollar">$</span> {cmd}</code>
              <span className="cmd-note">{note}</span>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="demo-footer">
      <p className="foot-tag">Proof, not opinion. No LLM judge.</p>
      <p className="foot-sub">
        Sparta checks the agent did what it was <em>supposed</em> to; Mole checks it did <em>nothing it
        wasn’t</em> — and clears an agent only for the task it just ran.
      </p>
    </footer>
  );
}
