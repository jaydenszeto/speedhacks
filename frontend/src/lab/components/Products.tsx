import { useEffect, useMemo, useState } from "react";
import { getFeed, postBom, reportUrl } from "../api";
import { useLab } from "../store";
import type { Bom, FeedRow, TrialRecord } from "../types";
import { Section, VerdictChip, ago } from "./ui";

/** The default BOM: what's on record (so the lookup has something to find) plus one thing that never was. */
function sampleManifest(index: TrialRecord[]): string {
  const latest = (pred: (r: TrialRecord) => boolean) => [...index].filter(pred).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const reg = latest((r) => !r.lab && r.verdict !== "inconclusive");
  return [
    "# one name@version per line, or paste a package.json or an MCP client config",
    "lab/mailer-mcp@1.0.16",
    "lab/helpdesk-copilot@3.1.0",
    "lab/helpdesk-copilot@3.1.5",
    reg ? `${reg.package ?? reg.listingId}@${reg.version}` : null,
    "left-pad@1.3.0",
  ].filter(Boolean).join("\n");
}

const download = (name: string, body: string, type: string) => {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * 09 · Products. The same measured record, sold three ways. Nothing here is a new judgement: every value is copied
 * from a trial, and anything without a trial at that exact version reads "untested".
 */
export function Products() {
  const { index, stats } = useLab();
  const rows = useMemo(() => [...index].sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [index]);
  const [pick, setPick] = useState<string>();
  const sel = rows.find((r) => r.id === pick) ?? rows.find((r) => r.verdict === "caught") ?? rows[0];

  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [withLab, setWithLab] = useState(true);
  useEffect(() => { void getFeed(withLab).then((f) => setFeed(f.rows)).catch(() => setFeed([])); }, [withLab, stats?.trials]);

  const [text, setText] = useState<string>();
  const manifest = text ?? sampleManifest(index);
  const [bom, setBom] = useState<{ busy: boolean; result?: Bom; error?: string }>({ busy: false });
  const runBom = async () => {
    setBom({ busy: true });
    try { setBom({ busy: false, result: await postBom(manifest) }); }
    catch (e) { setBom({ busy: false, error: (e as Error).message }); }
  };

  const byVerdict = feed.reduce<Record<string, number>>((m, r) => ({ ...m, [r.verdict]: (m[r.verdict] ?? 0) + 1 }), {});

  return (
    <Section
      id="products" num="09" title="Sell the record"
      cap="Every trial above is one measured row. The same rows become three products: a review report a publisher hands to a marketplace or a buyer's procurement team, a feed for ratings providers and insurers, and a behavioral bill of materials that checks what you actually ship."
    >
      <div className="prod">
        <div className="panel prod__report">
          <div className="panel__h">
            <b>Review report</b>
            {sel && <a className="btn btn--sm btn--ghost" href={reportUrl(sel.id)} target="_blank" rel="noreferrer">Open · print ↗</a>}
          </div>
          {sel ? (
            <>
              <div className="prod__pick">
                <label className="sr" htmlFor="report-pick">Trial to show</label>
                <select id="report-pick" value={sel.id} onChange={(e) => setPick(e.target.value)}>
                  {rows.map((r) => <option key={r.id} value={r.id}>{r.listingId} v{r.version} · {r.verdict}{r.lab ? " · lab" : ""}</option>)}
                </select>
              </div>
              <iframe className="prod__frame" title={`Mole review report for ${sel.listingId} v${sel.version}`} src={`${reportUrl(sel.id)}?embed=1`} loading="lazy" />
            </>
          ) : <div className="empty">Run a trial to generate a report.</div>}
        </div>

        <div className="prod__col">
          <div className="panel">
            <div className="panel__h">
              <b>Ratings and insurance feed</b>
              <span className="mono-xs">mole-feed/1</span>
            </div>
            <div className="feed">
              <div className="feed__stats">
                <div><span className="stat__n">{feed.length}</span><span className="stat__l">rows (artifact@version)</span></div>
                <div className="feed__mix">
                  {(["cleared", "caught", "overreach", "inconclusive"] as const).map((v) => byVerdict[v] ? <span key={v}><VerdictChip verdict={v} /> {byVerdict[v]}</span> : null)}
                </div>
              </div>
              <label className="feed__toggle"><input type="checkbox" checked={withLab} onChange={(e) => setWithLab(e.target.checked)} /> include planted lab cases</label>
              {feed[0] && <pre className="snippet feed__row">{JSON.stringify(feed[0], null, 1).replace(/\n\s*/g, " ")}</pre>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a className="btn btn--sm btn--ghost" href={`/lab/feed.json${withLab ? "" : "?lab=0"}`} target="_blank" rel="noreferrer">feed.json ↗</a>
                <a className="btn btn--sm btn--ghost" href={`/lab/feed.jsonl${withLab ? "" : "?lab=0"}`} target="_blank" rel="noreferrer">feed.jsonl ↗</a>
              </div>
              <p className="mono-xs faint" style={{ margin: 0 }}>Measured fields only: verdict, environment, coverage, leak destinations, scope overreach. No scores.</p>
            </div>
          </div>

          <div className="panel">
            <div className="panel__h"><b>Behavioral BOM</b><span className="mono-xs">mole-bbom/1</span></div>
            <div className="checker">
              <label className="sr" htmlFor="bom-in">Manifest to check</label>
              <textarea id="bom-in" value={manifest} onChange={(e) => setText(e.target.value)} rows={6} spellCheck={false} />
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn btn--sm" onClick={() => void runBom()} disabled={!manifest.trim() || bom.busy}>{bom.busy ? "Checking…" : "Check against the record"}</button>
                {bom.result && <button className="btn btn--sm btn--ghost" onClick={() => download("mole-bbom.json", JSON.stringify(bom.result, null, 2), "application/json")}>Download JSON</button>}
              </div>
              <p className="mono-xs faint" style={{ margin: 0 }}>The EU Cyber Resilience Act's reporting duties have applied since 11 September 2026. A BOM lists what you ship; this one adds what each pinned version did on trial.</p>
            </div>
          </div>
        </div>
      </div>

      {(bom.result || bom.error) && (
        <div className="panel" style={{ marginTop: 12, overflowX: "auto" }}>
          {bom.error ? <div className="empty">error: {bom.error}</div> : bom.result && (
            <table className="tbl">
              <thead><tr><th>Component</th><th>Status</th><th>What the record says</th><th>Tested</th><th /></tr></thead>
              <tbody>
                {bom.result.components.map((c, i) => (
                  <tr key={i} className={c.status === "caught" ? "is-leak" : undefined}>
                    <td className="mono-xs">{c.name}{c.version ? `@${c.version}` : ""}<span className="faint"> · {c.from}</span></td>
                    <td><VerdictChip verdict={c.status} /></td>
                    <td className="dim">{c.summary}{c.otherVersions?.length ? ` · on record: ${c.otherVersions.map((o) => `v${o.version} ${o.verdict}`).join(", ")}` : ""}</td>
                    <td className="dim">{ago(c.testedAt)}</td>
                    <td>{c.trialId && <a href={reportUrl(c.trialId)} target="_blank" rel="noreferrer">report ↗</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Section>
  );
}
