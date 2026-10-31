import { motion } from "motion/react";
import { useLab } from "../store";
import { EASE_OUT, Section } from "./ui";

const LAB_DEMO = "lab/mailer-mcp";

export function ReleaseWatch() {
  const { watch, runWatch, trial, pilot, crawl } = useLab();
  const running = watch.status === "running";
  const versions = watch.versions.length ? watch.versions : crawl.lab.find((l) => l.id === LAB_DEMO)?.lab?.versions ?? [];
  const doneCount = Object.keys(watch.results).length;
  const fill = versions.length > 1 ? Math.min(1, Math.max(0, (doneCount - 1) / (versions.length - 1))) : 0;
  const caught = watch.firstCaught;
  const inset = `calc(24px + (100% - 48px) / ${2 * Math.max(1, versions.length)})`;
  const clearedBefore = caught ? versions.indexOf(caught) : 0;

  return (
    <Section
      id="watch" num="04" title="Watch every release"
      cap="Trust belongs to a version, not a vendor. In 2025 an npm package called postmark-mcp shipped 15 clean versions, then 1.0.16 quietly BCC'd every email it sent to an outside address. Mole re-trials each release as it lands."
      aside={
        <button className="btn" onClick={() => void runWatch(LAB_DEMO)} disabled={running || trial.status === "running" || pilot.running || !crawl.lab.length}>
          {running ? `Trialing v${watch.current ?? "…"}` : watch.status === "done" ? "Watch again" : "Watch mailer-mcp releases"}
        </button>
      }
    >
      <div className="rail" role="list" aria-label="Versions">
        {/* line runs node-center to node-center: inner width is 100% − 2×24px padding, each column 1/n of it */}
        <div className="rail__line" style={{ left: inset, right: inset }} aria-hidden="true" />
        <div className="rail__fill" style={{ left: inset, width: `calc((100% - 48px) * ${(versions.length - 1) / Math.max(1, versions.length)} * ${fill})` }} aria-hidden="true" />
        {versions.map((v) => {
          const r = watch.results[v];
          const state = r?.verdict ?? (watch.current === v ? "running" : "pending");
          return (
            <div key={v} className={`node node--${state}`} role="listitem">
              <motion.div
                className="node__dot"
                animate={r ? { scale: [1.35, 1] } : { scale: 1 }}
                transition={{ duration: 0.6, ease: EASE_OUT }}
              >
                {r?.verdict === "caught" ? "!" : r?.verdict === "cleared" ? "✓" : r?.verdict === "overreach" ? "+" : r?.verdict === "inconclusive" ? "?" : ""}
              </motion.div>
              <div className="node__v">v{v}</div>
              <div className="node__s">{state === "pending" ? "not yet" : state === "running" ? "on trial" : state}</div>
            </div>
          );
        })}
        {!versions.length && <div className="empty" style={{ gridColumn: "1 / -1" }}>Crawl the registry first so the lab's cases load.</div>}
      </div>

      <div className="watch__call" aria-live="polite">
        <div className={`watch__big${caught ? " leak" : ""}`}>
          {caught ? `Flipped at v${caught}` : watch.status === "done" ? "No flip" : running ? `${doneCount}/${versions.length}` : "Idle"}
        </div>
        <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
          {caught
            ? `${clearedBefore} release${clearedBefore === 1 ? "" : "s"} cleared, then v${caught} was ${watch.results[caught]?.summary ?? "caught leaking"}. Anyone who pinned "trust this vendor" got the bad one automatically. Anyone gating on the Mole record didn't.`
            : watch.status === "done"
              ? "Every watched version cleared."
              : running
                ? "Each version is a full trial: fresh sandbox, fresh bait, every tool called. Watch it run in section 02."
                : watch.error ?? "Planted case. Its version history mirrors the real incident; every trial you see here still runs for real."}
        </div>
      </div>
    </Section>
  );
}
