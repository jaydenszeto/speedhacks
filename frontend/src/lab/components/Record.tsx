import { useMemo, useState } from "react";
import { badgeUrl } from "../api";
import { useLab } from "../store";
import { Counter, Section, VerdictChip, ago, ms } from "./ui";

export function Record() {
  const { index, stats, refreshRecord } = useLab();
  const rows = useMemo(() => [...index].sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [index]);
  const [pick, setPick] = useState<{ id: string; version: string }>();
  const sel = pick ?? (rows[0] ? { id: rows[0].listingId, version: rows[0].version } : undefined);
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const md = sel ? `[![Mole](${origin}${badgeUrl(sel.id, sel.version)})](${origin}/#record)` : "";

  return (
    <Section
      id="record" num="05" title="One record per version"
      cap="Every trial lands in a public record keyed by artifact and exact version. Maintainers embed the badge; buyers and agents query the same record."
      aside={<button className="btn btn--sm btn--ghost" onClick={() => void refreshRecord()}>Refresh</button>}
    >
      <div className="mk__meter" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div><Counter value={stats?.artifacts ?? 0} className="stat__n" /><div className="stat__l">Versions on record</div></div>
        <div><Counter value={stats?.cleared ?? 0} className="stat__n" /><div className="stat__l">Cleared</div></div>
        <div><Counter value={stats?.caught ?? 0} className={`stat__n${stats?.caught ? " leak" : ""}`} /><div className="stat__l">Caught</div></div>
        <div><Counter value={stats?.inconclusive ?? 0} className="stat__n" /><div className="stat__l">Inconclusive</div></div>
      </div>
      <div className="rec">
        <div className="panel rec__tbl">
          <table className="tbl">
            <thead><tr><th>Artifact</th><th>Version</th><th>Verdict</th><th>Tools</th><th>Ran</th><th>When</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="faint">The record is empty. Run a trial.</td></tr>}
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={[r.verdict === "caught" && "is-leak", sel?.id === r.listingId && sel.version === r.version && "is-sel"].filter(Boolean).join(" ") || undefined}
                  onClick={() => setPick({ id: r.listingId, version: r.version })}
                >
                  <td>{r.listingId}{r.lab && <span className="faint"> · lab</span>}</td>
                  <td className="ver">{r.version}</td>
                  <td><VerdictChip verdict={r.verdict} /></td>
                  <td>{r.toolsFound}</td>
                  <td className="dim">{r.runner === "sandbox" ? "sandbox" : "local"} · {ms(r.durationMs)}</td>
                  <td className="dim">{ago(r.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <div className="panel__h"><b>Badge</b><span>served live from the record</span></div>
          {sel ? (
            <div className="badge-demo">
              <div className="mono-xs dim">{sel.id} · v{sel.version}</div>
              <img src={badgeUrl(sel.id, sel.version)} alt={`Mole badge for ${sel.id} v${sel.version}`} key={`${sel.id}@${sel.version}@${index.length}`} />
              <div className="mono-xs dim">Embed in a README</div>
              <pre className="snippet">{md}</pre>
              <button
                className="btn btn--sm btn--ghost"
                onClick={() => { void navigator.clipboard?.writeText(md).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }); }}
              >
                {copied ? "Copied" : "Copy markdown"}
              </button>
              <p className="mono-xs faint" style={{ margin: 0 }}>Click any row to preview its badge. The badge carries the version it measured, so a new release reads untested until it's trialed.</p>
            </div>
          ) : <div className="empty">No badges yet.</div>}
        </div>
      </div>
    </Section>
  );
}
