import { useMemo, type ReactNode } from "react";
import { evidenceUrl } from "../api";
import { useLab } from "../store";
import type { TrialRecord } from "../types";
import { Section, ms, scrollToId } from "./ui";

/** Wrap every occurrence of the (redacted) matched bait in <mark>. */
function highlight(text: string, needles: string[]): ReactNode[] {
  const ns = [...new Set(needles.filter((n) => n && n.length > 3))].sort((a, b) => b.length - a.length);
  if (!ns.length) return [text];
  const re = new RegExp(`(${ns.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return text.split(re).map((part, i) => (ns.includes(part) ? <mark key={i}>{part}</mark> : part));
}

export function Evidence() {
  const { trial, index } = useLab();

  // Prefer the trial on screen; otherwise the most recent caught record, labelled as such.
  const { rec, fromRecord } = useMemo(() => {
    const cur = trial.record;
    if (cur?.verdict === "caught") return { rec: cur, fromRecord: false };
    const last = [...index].filter((r) => r.verdict === "caught").sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    return { rec: last, fromRecord: !!last };
  }, [trial.record, index]);

  return (
    <Section
      id="evidence" num="03" title="Keep the receipts"
      cap="A verdict is only worth the evidence behind it. Every catch ships the request that carried the bait, which tool sent it, and where it went. Bait values stay redacted, even here."
      aside={rec && <a className="btn btn--sm" href={evidenceUrl(rec.id)} target="_blank" rel="noreferrer">Evidence pack · JSON ↗</a>}
    >
      {!rec ? (
        <div className="panel empty">
          No catches on record yet. Trial <b>mailer-mcp v1.0.16</b> in section 02 to see what one looks like.
          <div style={{ marginTop: 16 }}><button className="btn btn--sm btn--ghost" onClick={() => scrollToId("trial")}>Go to trial ↑</button></div>
        </div>
      ) : (
        <EvidenceBody rec={rec} fromRecord={fromRecord} />
      )}
    </Section>
  );
}

function EvidenceBody({ rec, fromRecord }: { rec: TrialRecord; fromRecord: boolean }) {
  const leaks = rec.findings.filter((f) => !f.expected);
  const first = leaks[0];
  const needles = leaks.map((f) => f.matched ?? "");
  const lines = (first?.evidence ?? "").split("\n");
  return (
    <>
      {fromRecord && <p className="mono-xs dim" style={{ margin: "0 0 12px" }}>Showing the most recent catch on record ({rec.title} v{rec.version}). The trial on screen didn't catch anything.</p>}
      <div className="ev">
        <div className="panel">
          <div className="panel__h"><b>The request that carried the bait</b><span>{first?.tool ? `sent by ${first.tool}` : ""}</span></div>
          <pre className="raw">
            <span className="req">{highlight(lines[0] ?? "", needles)}</span>
            {"\n"}
            {highlight(lines.slice(1).join("\n"), needles)}
          </pre>
        </div>
        <div className="panel">
          <div className="panel__h"><b>Attribution</b><span className="chip chip--caught">caught</span></div>
          <dl className="attr">
            <dt>Artifact</dt><dd>{rec.listingId}</dd>
            <dt>Version</dt><dd>v{rec.version}</dd>
            <dt>Ran in</dt><dd>{rec.runner === "sandbox" ? "docker sandbox · network none" : "lab · local · sinkhole proxy"}</dd>
            <dt>Tested</dt><dd>{new Date(rec.startedAt).toLocaleString()} · {ms(rec.durationMs)}</dd>
            <dt>Coverage</dt><dd>{rec.toolsFound} tools · {rec.probes} probes · {rec.baitPlanted} bait items</dd>
            <dt>Trial id</dt><dd>{rec.id}</dd>
            <dt>Finding</dt><dd className="leak">{rec.summary}</dd>
          </dl>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16, overflowX: "auto" }}>
        <table className="tbl">
          <thead><tr><th>Bait</th><th>Matched as</th><th>Tool</th><th>Channel</th><th>Went to</th><th>Severity</th></tr></thead>
          <tbody>
            {rec.findings.map((f, i) => (
              <tr key={i} className={f.expected ? undefined : "is-leak"}>
                <td className={f.expected ? undefined : "leak"}>{f.canaryLabel}</td>
                <td className="dim">{f.matched || "—"}{f.decoding && f.decoding !== "plain" ? ` (${f.decoding})` : ""}</td>
                <td>{f.tool}</td>
                <td className="dim">{f.channel}</td>
                <td>{f.destination}{f.expected && <span className="faint"> · its own service</span>}</td>
                <td className="dim">{f.severity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
