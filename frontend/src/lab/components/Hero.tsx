import { motion } from "motion/react";
import { useLab } from "../store";
import { Counter, EASE_OUT } from "./ui";

const LINES: { text: string; soft?: boolean }[] = [
  { text: "We test the tools AI agents install" },
  { text: "for leaks." },
];

export function Hero({ onRun, onSkip }: { onRun: () => void; onSkip: () => void }) {
  const { stats, pilot, health } = useLab();

  return (
    <section className="hero wrap" id="top" aria-labelledby="hero-t">
      <motion.p
        className="hero__kicker"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.1 }}
      >
        Mole · behavioral evidence for software that acts on its own
      </motion.p>

      <h1 className="hero__title" id="hero-t">
        {LINES.map((l, i) => (
          <span className="line" key={l.text}>
            <motion.span
              className={l.soft ? "soft" : undefined}
              initial={{ y: "105%" }} animate={{ y: 0 }}
              transition={{ duration: 0.9, delay: 0.1 + i * 0.1, ease: EASE_OUT }}
            >
              {l.text}
            </motion.span>
          </span>
        ))}
      </h1>

      <motion.div
        className="hero__row"
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.65, ease: EASE_OUT }}
      >
        <div>
          <p className="hero__lede">
            Mole pulls tools straight from the public MCP Registry, runs each one in a sealed sandbox full of fake secrets,
            calls every tool, and records what tries to leave. Every number on this page was measured live.
          </p>
          <p className="hero__rule">The only red on this page is a leak.</p>
          <div className="hero__ctas">
            <button className="btn btn--solid" onClick={onRun} disabled={pilot.running || !health}>
              {pilot.running ? "Demo running…" : pilot.done ? "Run it again" : "Run the demo"} <span className="key" aria-hidden="true">R</span>
            </button>
            <button className="btn btn--ghost" onClick={onSkip}>Drive it yourself ↓</button>
          </div>
        </div>
        <div className="stats" aria-label="The record so far">
          <Stat n={stats?.trials ?? 0} l="Trials run" />
          <Stat n={stats?.artifacts ?? 0} l="Versions on record" />
          <Stat n={stats?.baitPlanted ?? 0} l="Bait planted" />
          <Stat n={stats?.caught ?? 0} l="Caught leaking" leak={(stats?.caught ?? 0) > 0} />
        </div>
      </motion.div>

    </section>
  );
}

function Stat({ n, l, leak }: { n: number; l: string; leak?: boolean }) {
  return (
    <div className="stat">
      <Counter value={n} className={`stat__n${leak ? " leak" : ""}`} />
      <div className="stat__l">{l}</div>
    </div>
  );
}
