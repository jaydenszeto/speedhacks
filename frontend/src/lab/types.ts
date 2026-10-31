/** Mirrors of the lab server's shapes (services/mole/src/lab). Kept narrow: only what the UI reads. */

export type ListingKind = "npm" | "pypi" | "oci" | "remote" | "other" | "lab";

export interface Listing {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string;
  kind: ListingKind;
  pkg?: { identifier: string; version: string; transport: string; requiredEnv: string[]; requiredArgs: string[] };
  remotes: string[];
  repo?: string;
  website?: string;
  publishedAt?: string;
  runnable: boolean;
  runnableNote: string;
  lab?: { note: string; versions: string[] };
}

export type Verdict = "cleared" | "caught" | "inconclusive";

export interface Finding {
  severity: string;
  tool: string;
  canaryId: string;
  canaryType: string;
  canaryLabel: string;
  channel: "egress" | "collector";
  destination: string;
  matched?: string;
  decoding?: string;
  evidence: string;
  expected?: boolean;
}

export interface TrialRecord {
  id: string;
  listingId: string;
  title: string;
  version: string;
  kind: string;
  lab: boolean;
  runner: "local" | "sandbox";
  startedAt: string;
  durationMs: number;
  verdict: Verdict;
  summary: string;
  toolsFound: number;
  toolNames: string[];
  probes: number;
  egress: number;
  baitPlanted: number;
  findings: Finding[];
  source?: { files: number; lines: number };
  error?: string;
}

export interface BaitItem { id: string; label: string; kind: string; preview: string; where: string }

export type LabEvent =
  | { type: "bait"; items: BaitItem[] }
  | { type: "spawn"; runner: "local" | "sandbox"; command: string }
  | { type: "source"; files: number; lines: number }
  | { type: "connected"; ms: number }
  | { type: "tools"; names: string[]; descriptions: Record<string, string> }
  | { type: "probe"; tool: string; args: string }
  | { type: "probe-done"; tool: string; ms: number; outcome: "ok" | "error" }
  | { type: "egress"; tool: string; method: string; scheme: string; host: string; target: string; bytes: number; bait: boolean }
  | { type: "finding"; finding: Finding }
  | { type: "error"; message: string }
  | { type: "done"; result: unknown }
  | { type: "stage"; stage: "queued" | "install" | "run" | "verdict"; text: string }
  | { type: "log"; text: string }
  | { type: "verdict"; record: TrialRecord };

export type WatchEvent =
  | { type: "watch-start"; listingId: string; title: string; versions: string[] }
  | { type: "watch-trial"; version: string; trialId: string }
  | { type: "watch-result"; version: string; trialId: string; verdict: Verdict; summary: string }
  | { type: "watch-done"; firstCaught?: string }
  | { type: "error"; message: string };

export interface Health {
  ok: boolean;
  sandbox: { docker: boolean; image: boolean; detail: string };
  registry: { ok: boolean; ms: number; detail: string };
  record: Stats;
}

export interface Stats {
  trials: number;
  artifacts: number;
  cleared: number;
  caught: number;
  inconclusive: number;
  probes: number;
  baitPlanted: number;
}

export interface GateResult {
  decision: "allow" | "block" | "hold";
  listingId: string;
  version?: string;
  reason: string;
  trialId: string | null;
}
