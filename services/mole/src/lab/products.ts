/**
 * Selling the record. Three ways the same measured trials become something people pay for:
 *
 *   reviewReportHtml   a printable behavioral review for one artifact@version: what a publisher attaches to a
 *                      marketplace security review, or a buyer files with procurement
 *   feed               one row per artifact@version with only measured fields: the dataset for ratings providers,
 *                      insurers and marketplaces (JSON or JSONL, schema "mole-feed/1")
 *   behavioralBom      check a dependency manifest (package.json, an MCP client config, or a plain list) against the
 *                      record at the exact versions you ship ("mole-bbom/1"): cleared / caught / overreach / untested
 *
 * Nothing here computes a new judgement. Every value is copied from a trial record, and anything without a trial at
 * that exact version says "untested", never "fine".
 */
import type { Listing } from "./registry.js";
import type { RecordStore, TrialRecord } from "./record.js";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ms = (n: number) => (n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(1)}s`);

/** `embed` drops the outer page chrome so the report sits flush inside an iframe. */
export function reviewReportHtml(r: TrialRecord, listing?: Listing | null, opts: { embed?: boolean } = {}): string {
  const leaks = r.findings.filter((f) => !f.expected);
  const own = r.findings.filter((f) => f.expected);
  const verdictColor = r.verdict === "caught" ? "#c62a14" : "#16161a";
  const isIntegration = r.kind === "integration";
  const env = r.runner === "sandbox"
    ? "Docker container, network none, all capabilities dropped; npm install with scripts disabled; egress observed by a runtime preload (bodies captured before TLS)."
    : isIntegration
      ? "Bait CRM tenant (Salesforce-shaped REST API) with planted records; OAuth token is bait; every API call logged; outbound calls logged and answered locally."
      : "Local process behind Mole's sinkhole proxy; outbound calls recorded and never forwarded.";
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mole behavioral review · ${esc(r.listingId)} v${esc(r.version)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { --ink:#16161a; --dim:rgba(22,22,26,.62); --line:rgba(22,22,26,.12); --leak:#c62a14; }
  * { box-sizing: border-box; } body { margin:0; background:#f7f6f2; color:var(--ink); font:15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 860px; margin: 48px auto; background:#fff; border:1px solid var(--line); border-radius:12px; padding:48px 56px; }
  h1 { font-size: 30px; letter-spacing:-.02em; margin: 6px 0 4px; } h2 { font-size: 16px; margin: 32px 0 10px; }
  .k { font: 12px ui-monospace, Menlo, monospace; color: var(--dim); } .v { font-weight:600; color:${verdictColor}; text-transform: capitalize; font-size: 22px; }
  table { width:100%; border-collapse: collapse; font-size: 14px; } th, td { text-align:left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { width: 190px; color: var(--dim); font-weight: 500; } .leak { color: var(--leak); } code, pre { font: 12px/1.6 ui-monospace, Menlo, monospace; }
  pre { background:#f7f6f2; border:1px solid var(--line); border-radius:8px; padding:12px; white-space: pre-wrap; overflow-wrap:anywhere; }
  .note { color: var(--dim); font-size: 13px; } @media print { body { background:#fff; } main { border:0; margin:0; } }
  body.embed { background:#fff; } body.embed main { margin:0; border:0; border-radius:0; padding:28px 32px; max-width:none; }
</style></head><body${opts.embed ? ' class="embed"' : ""}><main>
<div class="k">Mole behavioral review · trial ${esc(r.id)}</div>
<h1>${esc(r.title)} <span class="k">${esc(r.listingId)} · v${esc(r.version)}</span></h1>
<div class="v">${esc(r.verdict)}</div>
<p>${esc(r.summary)}</p>
<h2>What was tested</h2>
<table>
${row("Artifact", `${esc(r.listingId)} v${esc(r.version)}${r.package ? ` (package <code>${esc(r.package)}</code>)` : ""}${r.lab ? " · <b>planted lab case</b>" : ""}`)}
${row("Kind", esc(r.kind))}
${listing?.description ? row("Declares", esc(listing.description)) : ""}
${listing?.integration ? row("Declared scope", `read ${esc(listing.integration.scopes.read.join(", "))} · write ${esc(listing.integration.scopes.write.join(", "))} · own hosts ${esc(listing.integration.domains.join(", "))}`) : ""}
${row("Environment", esc(env))}
${row("Tested", `${esc(new Date(r.startedAt).toUTCString())} · ${ms(r.durationMs)}`)}
${row("Coverage", isIntegration ? `${r.apiCalls ?? r.probes} API calls served · ${r.baitPlanted} planted records/values · ${r.egress} outbound attempts` : `${r.toolsFound} tools (${esc(r.toolNames.join(", "))}) · ${r.probes} probes · ${r.baitPlanted} bait items · ${r.egress} outbound attempts`)}
${r.overreach ? row("Beyond declared scope", `read ${r.overreach.records} records from ${esc(r.overreach.objects.join(", "))}`) : ""}
</table>
<h2>Findings</h2>
${leaks.length ? `<table><tr><th>Bait</th><td><b>Went to</b> · via · severity</td></tr>${leaks.map((f) => `<tr><th class="leak">${esc(f.canaryLabel)}</th><td>${esc(f.destination)} · ${esc(f.tool)} · ${esc(f.severity)}</td></tr>`).join("")}</table>
<p class="k">First request that carried bait (values redacted):</p><pre>${esc(leaks[0]!.evidence)}</pre>` : "<p>No planted value left for a host this artifact doesn't declare as its own.</p>"}
${own.length ? `<p class="note">${own.length} planted value${own.length > 1 ? "s" : ""} reached the artifact's own declared service (${esc([...new Set(own.map((f) => f.destination))].join(", "))}). Recorded, not counted as a leak.</p>` : ""}
<h2>Limits</h2>
<p class="note">This review covers one exact version, the behaviour Mole could trigger with the probes above, and the environment described. It is evidence about what happened in this trial, not a guarantee about other versions, other inputs, or code paths that weren't reached. Bait values are minted by Mole per trial and are shown redacted. Re-test every release.</p>
</main></body></html>`;
}

/* ── Feed ─────────────────────────────────────────────────────────────────── */

export interface FeedRow {
  schema: "mole-feed/1";
  artifact: string;
  version: string;
  package: string | null;
  kind: string;
  lab: boolean;
  verdict: TrialRecord["verdict"];
  tested_at: string;
  environment: TrialRecord["runner"];
  duration_ms: number;
  tools: number;
  probes: number;
  bait_planted: number;
  outbound_attempts: number;
  leaks: number;
  leak_destinations: string[];
  overreach_objects: string[];
  trial_id: string;
}

export function feed(store: RecordStore, opts: { includeLab?: boolean } = {}): FeedRow[] {
  return store.index().filter((r) => opts.includeLab !== false || !r.lab).map((r) => {
    const leaks = r.findings.filter((f) => !f.expected);
    return {
      schema: "mole-feed/1", artifact: r.listingId, version: r.version, package: r.package ?? null, kind: r.kind, lab: r.lab,
      verdict: r.verdict, tested_at: r.startedAt, environment: r.runner, duration_ms: r.durationMs, tools: r.toolsFound,
      probes: r.probes, bait_planted: r.baitPlanted, outbound_attempts: r.egress, leaks: leaks.length,
      leak_destinations: [...new Set(leaks.map((f) => f.destination))], overreach_objects: r.overreach?.objects ?? [], trial_id: r.id,
    };
  });
}

/* ── Behavioral BOM ───────────────────────────────────────────────────────── */

export interface BomInputComponent { ref: string; name: string; version: string | null; from: "package.json" | "mcp-config" | "list" }

/** Split "name@version" (scoped names keep their leading @). */
export function splitSpec(spec: string): { name: string; version: string | null } {
  const s = spec.trim();
  const at = s.lastIndexOf("@");
  if (at <= 0) return { name: s, version: null };
  const v = s.slice(at + 1).trim();
  return { name: s.slice(0, at), version: v && v !== "latest" ? v : null };
}

const cleanRange = (v: string) => {
  const m = v.trim().match(/^[\^~=v]?(\d+\.\d+\.\d+[\w.-]*)$/);
  return m ? m[1]! : null; // ranges like ">=1 <2" or "*" have no single version to look up
};

/** Parse a package.json, an MCP client config ({mcpServers}), or a plain list of name@version lines. */
export function parseManifest(text: string): BomInputComponent[] {
  const out: BomInputComponent[] = [];
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = undefined; }
  if (json && typeof json === "object") {
    const j = json as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; mcpServers?: Record<string, { command?: string; args?: string[] }> };
    for (const deps of [j.dependencies, j.devDependencies]) {
      for (const [name, range] of Object.entries(deps ?? {})) out.push({ ref: `${name}@${range}`, name, version: cleanRange(range), from: "package.json" });
    }
    for (const [key, srv] of Object.entries(j.mcpServers ?? {})) {
      const args = srv.args ?? [];
      const spec = ["npx", "pnpx", "bunx", "uvx"].includes(srv.command ?? "") ? args.find((a) => !a.startsWith("-")) : undefined;
      if (!spec) { out.push({ ref: key, name: key, version: null, from: "mcp-config" }); continue; }
      const { name, version } = splitSpec(spec);
      out.push({ ref: `${key}: ${spec}`, name, version, from: "mcp-config" });
    }
    return out;
  }
  for (const line of text.split("\n")) {
    const l = line.replace(/#.*$/, "").trim();
    if (!l) continue;
    const { name, version } = splitSpec(l.split(/\s+/)[0]!);
    out.push({ ref: l, name, version, from: "list" });
  }
  return out;
}

export interface BomComponent extends BomInputComponent {
  status: "cleared" | "caught" | "overreach" | "inconclusive" | "untested";
  artifact?: string;
  trialId?: string;
  testedAt?: string;
  summary?: string;
  /** Set when other versions are on record but not this one. */
  otherVersions?: { version: string; verdict: string }[];
}

/** `packageOf` resolves a listing id to its package name, for trials recorded before records carried one. */
export function behavioralBom(text: string, store: RecordStore, packageOf: (listingId: string) => string | undefined = () => undefined) {
  const index = store.index();
  const components: BomComponent[] = parseManifest(text).map((c) => {
    const matches = index.filter((r) => r.listingId === c.name || (r.package ?? packageOf(r.listingId)) === c.name);
    const exact = c.version ? matches.filter((r) => r.version === c.version).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] : undefined;
    if (exact) return { ...c, status: exact.verdict, artifact: exact.listingId, trialId: exact.id, testedAt: exact.startedAt, summary: exact.summary };
    return {
      ...c, status: "untested" as const,
      summary: !c.version ? "no exact version pinned: nothing to look up" : matches.length ? `v${c.version} not trialed yet` : "never trialed",
      otherVersions: matches.length ? matches.map((r) => ({ version: r.version, verdict: r.verdict })) : undefined,
    };
  });
  const count = (s: BomComponent["status"]) => components.filter((c) => c.status === s).length;
  return {
    format: "mole-bbom/1" as const,
    generatedAt: new Date().toISOString(),
    summary: { components: components.length, cleared: count("cleared"), caught: count("caught"), overreach: count("overreach"), inconclusive: count("inconclusive"), untested: count("untested") },
    components,
  };
}
