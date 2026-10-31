/**
 * The record: every trial Mole has run, kept on disk (.mole/record.json). This is the compounding asset from the
 * strategy: the public index, the badges and the install gate all read from it, and every number they show is a
 * trial that actually ran. Evidence is stored redacted (bait values never stored in full).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../findings.js";
import { dataDir } from "./assets.js";

/** overreach: nothing undeclared left, but it read data beyond the scope it declared (integration trials). */
export type Verdict = "cleared" | "caught" | "overreach" | "inconclusive";

export interface RecordedFinding extends Finding {
  /** True when the data went only to the listing's own declared service, or stayed on loopback (not a leak). */
  expected: boolean;
}

/** Host part of a finding destination or egress host: drops " (TLS)", the port, and IPv6 brackets. */
export function hostOf(dest: string): string {
  const d = dest.replace(/\s*\(TLS\)$/, "").trim().toLowerCase();
  if (d.startsWith("[")) return d.slice(1, d.indexOf("]") > 0 ? d.indexOf("]") : undefined);
  return d.replace(/:\d+$/, "");
}

/**
 * Loopback never leaves the machine. Inside a sealed sandbox the only thing listening there is the server's own
 * local backend (many servers default to one on localhost) or nothing at all, so bait sent there is not a leak.
 * Bait that a server *fetches* (the collector channel) is still a call-home, wherever the collector runs.
 */
export function isLoopback(dest: string): boolean {
  const h = hostOf(dest);
  return h === "localhost" || h === "::1" || h === "0.0.0.0" || /^127(\.\d{1,3}){3}$/.test(h);
}

/** Verdict and one-line summary for an MCP trial, from its classified findings. Integration trials have their own. */
export function verdictFor(findings: RecordedFinding[], r: { toolsFound: number; probes: number; error?: string }): { verdict: Verdict; summary: string } {
  const leaks = findings.filter((f) => !f.expected);
  if (leaks.length) {
    const dests = [...new Set(leaks.map((f) => f.destination))];
    return { verdict: "caught", summary: `caught sending ${leaks.length} bait item${leaks.length > 1 ? "s" : ""} to ${dests.join(", ")}` };
  }
  if (r.toolsFound === 0) return { verdict: "inconclusive", summary: `couldn't trial: ${r.error ?? "no tools exposed"}` };
  const probes = `${r.probes} probe${r.probes === 1 ? "" : "s"}`;
  if (!findings.length) return { verdict: "cleared", summary: `cleared · ${probes} · bait untouched` };
  const local = findings.every((f) => f.channel === "egress" && isLoopback(f.destination));
  const declared = findings.every((f) => !(f.channel === "egress" && isLoopback(f.destination)));
  return {
    verdict: "cleared",
    summary: `cleared · ${probes} · bait only reached ${local ? "localhost, inside the sealed sandbox" : declared ? "its own declared service" : "its own declared service and localhost"}`,
  };
}

/**
 * Re-apply the current classification rules to a stored MCP trial. Rules only ever narrow what counts as a leak
 * (today: loopback egress is local), so this can flip caught → cleared but never invent a catch.
 */
export function reclassify(t: TrialRecord): TrialRecord {
  if (t.kind === "integration" || t.runner !== "sandbox") return t;
  let changed = false;
  const findings = t.findings.map((f) => {
    if (f.expected || f.channel !== "egress" || !isLoopback(f.destination)) return f;
    changed = true;
    return { ...f, expected: true };
  });
  return changed ? { ...t, findings, ...verdictFor(findings, t) } : t;
}

export interface TrialRecord {
  id: string;
  listingId: string;
  title: string;
  version: string;
  kind: string;
  lab: boolean;
  runner: "local" | "sandbox";
  /** Which sandbox ran a registry trial (absent on records made before microVMs, which were all docker). */
  sandbox?: "docker" | "microvm";
  startedAt: string;
  durationMs: number;
  verdict: Verdict;
  summary: string;
  toolsFound: number;
  toolNames: string[];
  probes: number;
  egress: number;
  baitPlanted: number;
  findings: RecordedFinding[];
  source?: { files: number; lines: number };
  error?: string;
  /** Package identifier for registry servers (e.g. an npm name), so dependency manifests can be matched to the record. */
  package?: string;
  /** Integration trials: what it read beyond its declared scope. */
  overreach?: { objects: string[]; records: number };
  /** Integration trials: API calls the bait tenant served. */
  apiCalls?: number;
}

export class RecordStore {
  private trials: TrialRecord[] = [];
  private readonly file: string;

  constructor(private readonly dir = dataDir()) {
    this.file = join(dir, "record.json");
    try {
      if (existsSync(this.file)) this.trials = ((JSON.parse(readFileSync(this.file, "utf8")) as { trials: TrialRecord[] }).trials ?? []).map(reclassify);
    } catch { this.trials = []; }
  }

  add(t: TrialRecord): void {
    this.trials.push(t);
    this.save();
  }

  private save() {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify({ trials: this.trials }, null, 2));
  }

  /** For shared persistence (persist.ts): the full set, and a union-by-id merge that keeps time order. */
  snapshot(): TrialRecord[] { return [...this.trials]; }
  merge(items: TrialRecord[]): void {
    const have = new Set(this.trials.map((t) => t.id));
    const fresh = items.filter((t) => !have.has(t.id)).map(reclassify);
    if (!fresh.length) return;
    this.trials = [...this.trials, ...fresh].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    this.save();
  }

  all(): TrialRecord[] { return [...this.trials]; }

  get(id: string): TrialRecord | undefined { return this.trials.find((t) => t.id === id); }

  /** Latest trial for a listing (optionally a specific version). */
  latest(listingId: string, version?: string): TrialRecord | undefined {
    for (let i = this.trials.length - 1; i >= 0; i--) {
      const t = this.trials[i]!;
      if (t.listingId === listingId && (!version || t.version === version)) return t;
    }
    return undefined;
  }

  /** One row per listing@version: the most recent trial. */
  index(): TrialRecord[] {
    const seen = new Map<string, TrialRecord>();
    for (const t of this.trials) seen.set(`${t.listingId}@${t.version}`, t);
    return [...seen.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  stats() {
    const idx = this.index();
    return {
      trials: this.trials.length,
      artifacts: idx.length,
      cleared: idx.filter((t) => t.verdict === "cleared").length,
      caught: idx.filter((t) => t.verdict === "caught").length,
      overreach: idx.filter((t) => t.verdict === "overreach").length,
      inconclusive: idx.filter((t) => t.verdict === "inconclusive").length,
      probes: this.trials.reduce((n, t) => n + t.probes, 0),
      baitPlanted: this.trials.reduce((n, t) => n + t.baitPlanted, 0),
    };
  }
}
