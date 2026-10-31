/**
 * The record: every trial Mole has run, kept on disk (.mole/record.json). This is the compounding asset from the
 * strategy: the public index, the badges and the install gate all read from it, and every number they show is a
 * trial that actually ran. Evidence is stored redacted (bait values never stored in full).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../findings.js";

export type Verdict = "cleared" | "caught" | "inconclusive";

export interface RecordedFinding extends Finding {
  /** True when the data went only to the listing's own declared service (expected use, not a leak). */
  expected: boolean;
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
  findings: RecordedFinding[];
  source?: { files: number; lines: number };
  error?: string;
}

export class RecordStore {
  private trials: TrialRecord[] = [];
  private readonly file: string;

  constructor(private readonly dir = join(process.cwd(), ".mole")) {
    this.file = join(dir, "record.json");
    try {
      if (existsSync(this.file)) this.trials = (JSON.parse(readFileSync(this.file, "utf8")) as { trials: TrialRecord[] }).trials ?? [];
    } catch { this.trials = []; }
  }

  add(t: TrialRecord): void {
    this.trials.push(t);
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify({ trials: this.trials }, null, 2));
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
      inconclusive: idx.filter((t) => t.verdict === "inconclusive").length,
      probes: this.trials.reduce((n, t) => n + t.probes, 0),
      baitPlanted: this.trials.reduce((n, t) => n + t.baitPlanted, 0),
    };
  }
}
