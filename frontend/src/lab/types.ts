/** Mirrors of the lab server's shapes (services/mole/src/lab). Kept narrow: only what the UI reads. */

export type ListingKind = "npm" | "pypi" | "oci" | "remote" | "other" | "lab" | "integration";

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
  integration?: { platform: string; task: string; scopes: { read: string[]; write: string[] }; domains: string[] };
}

export type Verdict = "cleared" | "caught" | "overreach" | "inconclusive";

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
  findings: Finding[];
  source?: { files: number; lines: number };
  error?: string;
  package?: string;
  overreach?: { objects: string[]; records: number };
  apiCalls?: number;
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
  | { type: "egress"; tool: string; method: string; scheme: string; host: string; target: string; bytes: number; bait: boolean; own?: boolean }
  | { type: "finding"; finding: Finding }
  | { type: "error"; message: string }
  | { type: "done"; result: unknown }
  | { type: "stage"; stage: "queued" | "install" | "run" | "verdict"; text: string }
  | { type: "log"; text: string }
  | { type: "verdict"; record: TrialRecord }
  | { type: "tenant"; platform: string; objects: { name: string; records: number }[]; planted: number; scopes: { read: string[]; write: string[] }; task: string }
  | { type: "api"; method: string; op: "query" | "read" | "describe" | "write" | "auth-failed" | "other"; object?: string; fields?: string[]; rows: number; recordIds: string[]; planted: number; inScope: boolean; path: string };

export type WatchEvent =
  | { type: "watch-start"; listingId: string; title: string; versions: string[] }
  | { type: "watch-trial"; version: string; trialId: string }
  | { type: "watch-result"; version: string; trialId: string; verdict: Verdict; summary: string }
  | { type: "watch-done"; firstCaught?: string }
  | { type: "error"; message: string };

export interface Health {
  ok: boolean;
  /** Where registry trials run here: Docker locally, a Vercel Sandbox microVM when hosted, or nowhere. */
  sandbox: { kind?: "docker" | "microvm" | "none"; ready?: boolean; docker: boolean; image: boolean; detail: string };
  registry: { ok: boolean; ms: number; detail: string };
  record: Stats;
  persistence?: "local" | "blob";
  host?: "local" | "vercel";
}

export interface Stats {
  trials: number;
  artifacts: number;
  cleared: number;
  caught: number;
  overreach: number;
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

/* ── Planted identities ── */
export interface MaskedIdentity { id: string; vendor: string; purpose: string; issuedAt: string; source: string; name: string; email: string; phone: string; address: string; phrase: string }
export type SightingField = "email" | "phone" | "address" | "phrase";
export interface Sighting { identityId: string; vendor: string; fields: SightingField[]; source: string }
export type IdentityEvent =
  | { type: "world"; vendors: { id: string; does: string; channel: string }[] }
  | { type: "minted"; vendor: string; identity: MaskedIdentity }
  | { type: "handoff"; vendor: string; channel: string; status: number }
  | { type: "sweep"; source: string; detail: string; bytes: number }
  | { type: "sighting"; sighting: Sighting }
  | { type: "summary"; sightings: Sighting[]; quiet: string[] }
  | { type: "error"; message: string };

/* ── Products ── */
export interface FeedRow {
  schema: "mole-feed/1"; artifact: string; version: string; package: string | null; kind: string; lab: boolean; verdict: Verdict;
  tested_at: string; environment: string; duration_ms: number; tools: number; probes: number; bait_planted: number;
  outbound_attempts: number; leaks: number; leak_destinations: string[]; overreach_objects: string[]; trial_id: string;
}
export type BomStatus = Verdict | "untested";
export interface BomComponent {
  ref: string; name: string; version: string | null; from: string; status: BomStatus; artifact?: string; trialId?: string;
  testedAt?: string; summary?: string; otherVersions?: { version: string; verdict: string }[];
}
export interface Bom {
  format: "mole-bbom/1"; generatedAt: string;
  summary: { components: number; cleared: number; caught: number; overreach: number; inconclusive: number; untested: number };
  components: BomComponent[];
}
