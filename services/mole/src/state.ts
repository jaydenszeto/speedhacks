/** Persist the last scan/run/pick/hire so `mole report` can render it. Written under .mole/ in the working directory. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanResult } from "./findings.js";
import type { PickResult } from "./pick.js";
import type { HireResult } from "./hire.js";

const DIR = join(process.cwd(), ".mole");
const SCAN = join(DIR, "last-scan.json");
const RUN = join(DIR, "last-run.json");
const PICK = join(DIR, "last-pick.json");
const HIRE = join(DIR, "last-hire.json");

function save(file: string, data: unknown): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}
function load<T>(file: string): T | undefined {
  try { return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined; } catch { return undefined; }
}

export function saveLastScan(r: ScanResult): void { save(SCAN, r); }
export function loadLastScan(): ScanResult | undefined { return load<ScanResult>(SCAN); }

export interface RunRecord {
  kind: "run";
  target: string;
  agentRole: string;
  model: string;
  skill?: string;
  sessionId: string;
  actionsCompleted: number;
  approvalsNeeded: number;
  blocked: number;
  trips: { number: string; severity: string; headline: string; detectedVia: string; actor?: string; destination?: string }[];
  utility: { percent: number; correct: number; total: number };
  alert?: { toMasked: string; mode: string; status: string };
  at: string;
}
export function saveLastRun(r: RunRecord): void { save(RUN, r); }
export function loadLastRun(): RunRecord | undefined { return load<RunRecord>(RUN); }

export function saveLastPick(r: PickResult): void { save(PICK, r); }
export function loadLastPick(): PickResult | undefined { return load<PickResult>(PICK); }

export function saveLastHire(r: HireResult): void { save(HIRE, r); }
export function loadLastHire(): HireResult | undefined { return load<HireResult>(HIRE); }

export const statePaths = { dir: DIR, scan: SCAN, run: RUN, pick: PICK, hire: HIRE };
