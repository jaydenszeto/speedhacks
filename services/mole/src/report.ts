/**
 * `mole report` — render a Trust Report as a self-contained static HTML file from the most recent hire, pick, scan,
 * or run. The tagline leads; then, for a hire/pick, the two-line verdict per candidate (job done? bait untouched?)
 * with evidence for anything caught; then scan/run detail if present; then "previous trips for this skill" from
 * Keewano. Restrained and professional, no decorative animation. Prints the file path. Written for a non-technical
 * reader: bait, caught, cleared.
 */
import { statSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildAdapters } from "@tripwire/adapters";
import { loadLastScan, loadLastRun, loadLastPick, loadLastHire, statePaths } from "./state.js";
import { col } from "./format.js";
import type { ScanResult } from "./findings.js";
import type { RunRecord } from "./state.js";
import type { PickResult } from "./pick.js";
import type { HireResult } from "./hire.js";
import type { TrialResult } from "./trial.js";

export const TAGLINE = "Mole: we catch bad AI agents red-handed.";
export const PITCH =
  "The trust layer for AI agents hiring other AI agents. Every candidate is cleared — job done, and bait untouched — before it's used, so people stop watching each step and assistants get a cleared-or-caught answer without asking a human.";

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
function mtime(p: string): number { try { return statSync(p).mtimeMs; } catch { return 0; } }

export async function report(outPath?: string): Promise<{ path: string } | { error: string }> {
  const scan = loadLastScan();
  const run = loadLastRun();
  const pickRec = loadLastPick();
  const hireRec = loadLastHire();
  if (!scan && !run && !pickRec && !hireRec) return { error: "Nothing on record yet. Run `mole hire`, `mole pick`, `mole scan`, or `mole run` first." };

  // The newest hire/pick drives the headline verdict; a hire embeds its own pick.
  const hireNewer = mtime(statePaths.hire) >= mtime(statePaths.pick);
  const trialSource: { trials: TrialResult[]; cleared: string[]; hired?: string; task: string; durationMs: number } | undefined =
    hireRec && (hireNewer || !pickRec)
      ? { trials: hireRec.pick?.trials ?? [], cleared: hireRec.pick?.clearedLabels ?? [], hired: hireRec.hired, task: hireRec.task, durationMs: hireRec.pick?.durationMs ?? 0 }
      : pickRec
        ? { trials: pickRec.trials, cleared: pickRec.clearedLabels, task: pickRec.task, durationMs: pickRec.durationMs }
        : undefined;

  const subjectSkill = run?.skill ?? (scan ? scan.target.split(/[\s/]+/).find((p) => /mcp|helper|server/i.test(p)) : undefined) ?? "billing-helper";

  let prior: { skill: string; trips: number }[] = [];
  try {
    const adapters = buildAdapters(process.env);
    const intel = await adapters.keewano.fleetIntel();
    prior = intel.skills.filter((s) => !subjectSkill || s.skill.toLowerCase().includes(subjectSkill.toLowerCase()) || subjectSkill.toLowerCase().includes(s.skill.toLowerCase()));
    if (prior.length === 0) prior = intel.skills;
  } catch { /* Keewano unreachable — section shows "no history on record" */ }

  const html = renderHtml({ scan, run, trialSource, prior });
  const path = resolve(outPath ?? resolve(statePaths.dir, "report.html"));
  mkdirSync(statePaths.dir, { recursive: true });
  writeFileSync(path, html);
  return { path };
}

function statusLabel(t: TrialResult): { text: string; cls: string } {
  if (t.cleared) return { text: "CLEARED", cls: "cleared" };
  if (t.baitUntouched) return { text: "CLEAN · JOB NOT DONE", cls: "clean" };
  return { text: "CAUGHT", cls: "caught" };
}

function jobDetail(t: TrialResult): string {
  if (t.jobDone) return `refund issued within policy, ticket solved · utility ${t.utilityPercent}%`;
  if (t.key === "ticket-triage") return `no refund issued — ticket-triage has no refund tool · utility ${t.utilityPercent}%`;
  return `refund not completed · utility ${t.utilityPercent}%`;
}

function candidatesHtml(src: NonNullable<Parameters<typeof renderHtml>[0]["trialSource"]>): string {
  const blocks = src.trials.map((t) => {
    const s = statusLabel(t);
    const caught = !t.baitUntouched
      ? `<div class="c-line bad">Bait untouched: <strong>NO (caught)</strong></div>` +
        t.caughtItems.slice(0, 2).map((c) => `<div class="c-ev">took ${esc(c.took)}${c.destination ? ` → <span class="mono">${esc(c.destination)}</span>` : ""}${c.rawRequest ? `<pre class="evidence">${esc(c.rawRequest)}</pre>` : ""}</div>`).join("")
      : `<div class="c-line">Bait untouched: <strong>yes</strong></div>`;
    const keewano = t.priorTrips != null ? `<div class="c-line dim">Keewano: ${t.priorTrips} prior trip${t.priorTrips === 1 ? "" : "s"} on record for ${esc(t.skill ?? "")}</div>` : "";
    return `
    <div class="cand cand-${s.cls}">
      <div class="c-head"><span class="status status-${s.cls}">${s.text}</span><span class="name">${esc(t.label)}</span><span class="meta">${esc(t.model)}${t.skill ? ` · skill ${esc(t.skill)}` : ""}</span></div>
      <div class="c-line">Job done: <strong>${t.jobDone ? "yes" : "no"}</strong> <span class="dim">— ${esc(jobDetail(t))}</span></div>
      ${caught}
      ${keewano}
    </div>`;
  }).join("");
  const cleared = src.cleared.length ? `<strong>${esc(src.cleared.join(", "))}</strong>` : "<strong>none</strong>";
  const hired = src.hired ? ` · hired <strong>${esc(src.hired)}</strong>` : "";
  return `${blocks}\n<p class="summary">Cleared: ${cleared}${hired} <span class="dim">· checks took ${(src.durationMs / 1000).toFixed(1)}s</span></p>`;
}

function findingsHtml(scan: ScanResult): string {
  if (!scan.findings.length) return `<p class="clean">${scan.probes} probes sent. 0 caught. (Mole reports what it tested and what was caught — not a clean bill of health.)</p>`;
  return [...scan.findings]
    .sort((a, b) => ({ critical: 0, high: 1, medium: 2 }[a.severity] - { critical: 0, high: 1, medium: 2 }[b.severity]))
    .map((f) => `
    <div class="finding sev-${f.severity}">
      <div class="f-head"><span class="sev">${f.severity}</span><span class="tool">${esc(f.tool)}</span><span class="ctype">${esc(f.canaryType)} · ${esc(f.canaryLabel)}</span></div>
      <div class="f-dest">${f.channel === "collector" ? "called home to the collector" : `sent out → ${esc(f.destination)}`}${f.decoding && f.decoding !== "raw" ? ` <span class="dim">[${esc(f.decoding)}-decoded]</span>` : ""}</div>
      <pre class="evidence">${esc(f.evidence)}</pre>
    </div>`).join("");
}

function tripsHtml(run: RunRecord): string {
  if (!run.trips.length) return `<p class="clean">0 caught across ${run.actionsCompleted} actions.</p>`;
  return run.trips.map((t) => `
    <div class="finding sev-${t.severity}">
      <div class="f-head"><span class="sev">${t.severity}</span><span class="tool">${esc(t.number)}</span><span class="ctype">${t.actor ? esc(t.actor) : "model"}${t.destination ? ` → ${esc(t.destination)}` : ""}</span></div>
      <div class="f-dest">${esc(t.headline)} <span class="dim">(via ${esc(t.detectedVia.replace(/_/g, " "))})</span></div>
    </div>`).join("");
}

function renderHtml({ scan, run, trialSource, prior }: {
  scan?: ScanResult; run?: RunRecord;
  trialSource?: { trials: TrialResult[]; cleared: string[]; hired?: string; task: string; durationMs: number };
  prior: { skill: string; trips: number }[];
}): string {
  const date = new Date().toLocaleString("en-US");
  const subject = trialSource?.task ?? run?.target ?? scan?.target ?? "—";
  const priorHtml = prior.length
    ? `<ul class="prior">${prior.map((p) => `<li><span class="mono">${esc(p.skill)}</span><span class="dim">${p.trips} prior trip${p.trips === 1 ? "" : "s"} on record</span></li>`).join("")}</ul>`
    : `<p class="dim">No prior history on record.</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mole Trust Report</title>
<style>
  :root{--ground:#faf9f7;--surface:#fff;--line:#e7e4df;--ink:#1c1a17;--ink64:rgba(28,26,23,.64);--ink48:rgba(28,26,23,.48);
    --sage:#4f8a6e;--sage-ink:#2a5440;--sage-wash:#eef4f0;--brick:#b5483a;--brick-wash:#faecea;--amber:#b7791f;--amber-wash:#f7efdd;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--ink);font:15px/1.55 "Geist",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  .mono{font-family:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace}
  .sheet{max-width:820px;margin:48px auto;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:48px;box-shadow:0 1px 2px rgba(28,26,23,.04),0 12px 32px -20px rgba(28,26,23,.28)}
  .head{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:16px}
  .brand{font-weight:600;letter-spacing:-.02em}.date{font-size:12px;color:var(--ink48)} .mono.date{font-family:"Geist Mono",monospace}
  .tagline{margin:28px 0 8px;font-size:24px;line-height:1.25;letter-spacing:-.02em;font-weight:600}
  .pitch{margin:0 0 18px;font-size:15px;line-height:1.5;color:var(--ink64)}
  .subject{font-size:13px;color:var(--ink48);margin-bottom:8px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink48);margin:32px 0 12px;font-weight:600}
  .cand{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:12px}
  .cand-cleared{background:var(--sage-wash);border-color:#cfe3d8}.cand-caught{background:var(--brick-wash);border-color:#ecc6bf}.cand-clean{background:var(--amber-wash);border-color:#e8d9b4}
  .c-head{display:flex;align-items:center;gap:10px;margin-bottom:6px}
  .status{font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;padding:2px 8px;border-radius:5px;color:#fff}
  .status-cleared{background:var(--sage)}.status-caught{background:var(--brick)}.status-clean{background:var(--amber)}
  .name{font-weight:600}.meta{color:var(--ink48);font-size:13px;font-family:"Geist Mono",monospace}
  .c-line{font-size:14px;margin-top:2px}.c-line.bad strong{color:var(--brick)}.c-ev{font-size:13px;margin-top:6px;color:var(--ink64)}
  .summary{font-size:15px;margin-top:4px}
  .finding{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:12px}
  .finding.sev-critical,.finding.sev-high{background:var(--brick-wash);border-color:#ecc6bf}.finding.sev-medium{background:var(--amber-wash);border-color:#e8d9b4}
  .f-head{display:flex;align-items:center;gap:10px}
  .sev{font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;padding:2px 8px;border-radius:5px;background:var(--brick);color:#fff}
  .sev-medium .sev{background:var(--amber)}
  .tool{font-family:"Geist Mono",monospace;font-weight:600}.ctype{color:var(--ink64);font-size:13px}
  .f-dest{margin-top:6px;font-size:13px}.dim{color:var(--ink48)}
  pre.evidence{margin:8px 0 0;background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-family:"Geist Mono",monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:var(--ink64)}
  .clean{color:var(--sage-ink);background:var(--sage-wash);border:1px solid #cfe3d8;border-radius:10px;padding:12px 14px;font-size:14px}
  ul.prior{list-style:none;padding:0;margin:0}ul.prior li{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}
  .foot{margin-top:36px;padding-top:16px;border-top:1px solid var(--line);color:var(--ink48);font-size:12px}
</style></head>
<body><div class="sheet">
  <div class="head"><span class="brand">Mole Trust Report</span><span class="mono date">${esc(date)}</span></div>
  <p class="tagline">${esc(TAGLINE)}</p>
  <p class="pitch">${esc(PITCH)}</p>
  <div class="subject">Task: <span class="mono">${esc(subject)}</span></div>
  ${trialSource ? `<h2>Candidates — cleared or caught</h2>${candidatesHtml(trialSource)}` : ""}
  ${scan ? `<h2>Server scan</h2>${findingsHtml(scan)}` : ""}
  ${run ? `<h2>Live run</h2>${tripsHtml(run)}` : ""}
  <h2>Previous trips for this skill</h2>
  ${priorHtml}
  <div class="foot">Proof, not opinion — generated from recorded events, no LLM judge. Sparta checks the agent did what it was supposed to; Mole checks it did nothing it wasn't. Mole reports what was tested and what was caught; it does not certify any agent as safe.</div>
</div></body></html>`;
}
