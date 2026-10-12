/**
 * Terminal rendering for `mole scan`, in the spirit of a dependency-audit tool / Semgrep: a short header, grouped findings
 * with raw evidence, and one measured summary line. Readable at recording resolution — short lines, consistent
 * colour. Honours NO_COLOR and non-TTY output.
 */
import type { ScanResult } from "./findings.js";
import type { Severity } from "@tripwire/canary-core";

// Colour when attached to a TTY, or when FORCE_COLOR is set (e.g. the demo streams piped output to a browser
// that renders the ANSI itself). NO_COLOR always wins.
const useColor = (process.stdout.isTTY || !!process.env.FORCE_COLOR) && !process.env.NO_COLOR;
const c = (code: string) => (s: string | number) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const col = {
  red: c("31"), yellow: c("33"), green: c("32"), dim: c("2"), bold: c("1"), cyan: c("36"), under: c("4"),
};

/** Mask a phone number to its last two digits for any printed/rendered output. */
export function maskPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.length < 2) return "••";
  return `${"•".repeat(Math.max(3, d.length - 2))}${d.slice(-2)}`;
}

/**
 * Redact a single known secret value to its prefix + last four characters only — never the full secret.
 * A recognisable scheme prefix (`sk_live_`, `postgres://`, …) is kept; otherwise the first 8 chars.
 */
export function redactSecretValue(v: string): string {
  const s = String(v);
  if (s.length <= 10) return s;
  const schemeMatch = s.match(/^(sk_live_|sk_test_|rk_live_|whsec_|postgres:\/\/|mysql:\/\/|mongodb(?:\+srv)?:\/\/|https?:\/\/)/i);
  const head = schemeMatch ? schemeMatch[1] : s.slice(0, 8);
  return `${head}…${s.slice(-4)}`;
}

/**
 * Redact secrets anywhere in a free-text line to prefix + last four. Any exact `known` secret values are
 * masked first; then common secret shapes (API keys, connection strings) and phone numbers as a backstop.
 */
export function redactSecrets(text: string, known: string[] = []): string {
  let out = String(text);
  for (const k of known) {
    if (k && k.length > 10) out = out.split(k).join(redactSecretValue(k));
  }
  return out
    .replace(/(sk_live_|sk_test_|rk_live_|whsec_)[A-Za-z0-9]{6,}/g, (_m, p) => `${p}…${_m.slice(-4)}`)
    .replace(/(postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi, (_m, p) => `${p}://…`)
    .replace(/\+?\d[\d\s().-]{8,16}\d/g, (m) => maskPhone(m));
}

/** "1 file" / "2 files" — keeps the header and summary line grammatical at recording resolution. */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

const SEV_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2 };
function sevTag(s: Severity): string {
  const label = s.padEnd(8);
  return s === "critical" ? col.red(col.bold(label)) : s === "high" ? col.yellow(label) : col.dim(label);
}

function indent(text: string, pad: string): string {
  return text.split("\n").map((l) => pad + l).join("\n");
}

/** Abbreviate a long secret for the one-line "matched" row, keeping head and tail. */
function abbrev(s: string, keep = 28): string {
  return s.length <= keep + 8 ? s : `${s.slice(0, keep)}…${s.slice(-6)}`;
}

/** Cap evidence so a long JSON body stays readable at recording resolution. */
function cap(text: string, max = 300): string {
  const oneLineMax = 160;
  const lines = text.split("\n").map((l) => (l.length > oneLineMax ? `${l.slice(0, oneLineMax)}…` : l));
  const joined = lines.join("\n");
  return joined.length > max ? `${joined.slice(0, max)}…` : joined;
}

export function renderScan(r: ScanResult): string {
  const out: string[] = [];
  out.push("");
  out.push(`${col.bold("mole scan")} ${col.dim("—")} ${r.target}`);
  out.push("");

  const depLabel = r.source.depsKind === "transitive" ? plural(r.source.dependencies, "dep") : plural(r.source.dependencies, "direct dep");
  const src = r.source.located
    ? `${plural(r.source.files, "file")} · ${plural(r.source.lines, "line")} · ${depLabel}`
    : col.dim("source not on disk (external package)");
  out.push(`  ${col.dim("target")}   ${r.target}`);
  out.push(`  ${col.dim("source")}   ${src}`);
  out.push(`  ${col.dim("tools")}    ${r.toolsFound} enumerated${r.toolNames.length ? col.dim(`  (${r.toolNames.join(", ")})`) : ""}`);
  out.push(`  ${col.dim("probes")}   ${r.probes} sent`);
  if (r.error) out.push(`  ${col.red("error")}    ${r.error}`);
  out.push("");

  const sorted = [...r.findings].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  if (sorted.length) {
    out.push(col.bold(`FINDINGS (${sorted.length})`));
    out.push("");
    for (const f of sorted) {
      const via = f.channel === "collector" ? "called home" : `egress → ${f.destination}`;
      const dec = f.decoding && f.decoding !== "raw" ? col.dim(` [${f.decoding}-decoded]`) : "";
      out.push(`  ${sevTag(f.severity)} ${col.bold(f.tool)}  ${col.dim(f.canaryType)} · ${f.canaryLabel}`);
      out.push(`           ${via}${dec}`);
      if (f.matched) out.push(`           ${col.dim("matched")} ${abbrev(redactSecretValue(f.matched))}`);
      out.push(col.dim(indent(cap(redactSecrets(f.evidence, f.matched ? [f.matched] : [])), "             ")));
      out.push("");
    }
  }

  const reviewedDeps = r.source.depsKind === "transitive" ? plural(r.source.dependencies, "dependency", "dependencies") : plural(r.source.dependencies, "direct dependency", "direct dependencies");
  const reviewed = r.source.located
    ? `Reviewed ${plural(r.source.files, "file")}, ${plural(r.source.lines, "line")}, ${reviewedDeps}.`
    : "Reviewed the server's live tool surface (source not on disk).";
  out.push(col.dim(`${reviewed} Scan time: ${(r.durationMs / 1000).toFixed(1)}s.`));

  const n = r.findings.length;
  const line = `${n} trip${n === 1 ? "" : "s"} across ${r.probes} probe${r.probes === 1 ? "" : "s"}.`;
  out.push(n ? col.red(col.bold(line)) : col.green(line));
  out.push("");
  return out.join("\n");
}
