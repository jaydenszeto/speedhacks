/**
 * The lab: Mole's trial orchestrator behind the live demo.
 *
 *   trials   one listing@version through scan(): planted bait, every tool probed, every outbound attempt observed.
 *            Registry npm servers run in a sandbox (Docker locally, a Vercel Sandbox microVM when hosted); the lab's
 *            own planted test cases run locally.
 *   watch    release watch: trial every published version in order, oldest first.
 *   gate     an agent asks "may I install X@v?" and gets an answer from the record.
 *
 * Trials run one at a time (a queue), each with a replayable event log so the UI can attach mid-trial.
 */
import { resolve } from "node:path";
import { scan, localRunner, type ScanEvent } from "../scan.js";
import { fetchVersions, declaredDomains, rootDomain, type Listing } from "./registry.js";
import { dockerStatus, installPackage, sandboxRunner } from "./sandbox.js";
import { microvmAvailable, microvmScan } from "./microvm.js";
import { INTEGRATION_LISTINGS, runIntegration, type IntegrationEvent } from "./integrations.js";
import { RecordStore, hostOf, isLoopback, verdictFor, type TrialRecord, type RecordedFinding, type Verdict } from "./record.js";
import { REPO, nodeArgs } from "./assets.js";

/** Registry trials in microVMs cost real compute; a public demo caps them (shared across instances via the record). */
const MICROVM_PER_HOUR = Number(process.env.MOLE_MICROVM_PER_HOUR ?? 40);

const fixture = (name: string) => resolve(REPO, "services/mole/fixtures", name, "server.ts");

/** The lab's own planted test cases. Clearly labeled everywhere they appear; never mixed into registry numbers. */
export const LAB_LISTINGS: Listing[] = [
  {
    id: "lab/mailer-mcp", name: "lab/mailer-mcp", title: "mailer-mcp",
    description: "Send transactional email from your agent: receipts, password resets, notifications.",
    version: "1.0.16", kind: "lab", remotes: [], runnable: true, runnableNote: "lab · runs locally",
    lab: {
      note: "Planted test case modeled on the postmark-mcp incident: clean for 15 versions, then v1.0.16 adds a BCC.",
      versions: ["1.0.0", "1.0.4", "1.0.9", "1.0.12", "1.0.15", "1.0.16"], entry: fixture("mailer-mcp"), envVersion: true,
    },
  },
  {
    id: "lab/billing-helper", name: "lab/billing-helper", title: "billing-helper",
    description: "Validate and archive billing records for support automation agents.",
    version: "2.1.0", kind: "lab", remotes: [], runnable: true, runnableNote: "lab · runs locally",
    lab: { note: "Planted test case: exfiltrates only when it sees a live-looking Stripe key.", versions: ["2.1.0"], entry: fixture("billing-helper-mcp") },
  },
  {
    id: "lab/safe-notes", name: "lab/safe-notes", title: "safe-notes",
    description: "A tiny in-memory notes server. Makes no network calls.",
    version: "1.0.0", kind: "lab", remotes: [], runnable: true, runnableNote: "lab · runs locally",
    lab: { note: "Planted control case: a clean server.", versions: ["1.0.0"], entry: fixture("safe-notes-mcp") },
  },
];

export type LabEvent =
  | ScanEvent
  | Exclude<IntegrationEvent, { type: "bait" | "spawn" | "egress" | "finding" | "error" }>
  | { type: "stage"; stage: "queued" | "install" | "run" | "verdict"; text: string }
  | { type: "log"; text: string }
  | { type: "verdict"; record: TrialRecord };

export type WatchEvent =
  | { type: "watch-start"; listingId: string; title: string; versions: string[] }
  | { type: "watch-trial"; version: string; trialId: string }
  | { type: "watch-result"; version: string; trialId: string; verdict: Verdict; summary: string }
  | { type: "watch-done"; firstCaught?: string }
  | { type: "error"; message: string };

/** A replayable event log with live subscribers. */
export class Stream<E> {
  readonly events: E[] = [];
  private subs = new Set<(e: E) => void>();
  done = false;
  push(e: E) { this.events.push(e); for (const s of this.subs) s(e); }
  end() { this.done = true; for (const s of this.subs) s(undefined as unknown as E); this.subs.clear(); }
  subscribe(fn: (e: E) => void): () => void { this.subs.add(fn); return () => this.subs.delete(fn); }
}

export interface TrialRun { id: string; listing: Listing; version: string; stream: Stream<LabEvent>; record?: TrialRecord }
export interface WatchRun { id: string; listingId: string; stream: Stream<WatchEvent> }

const newId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class Lab {
  constructor(readonly record = new RecordStore()) {}
  readonly listings = new Map<string, Listing>([...LAB_LISTINGS, ...INTEGRATION_LISTINGS].map((l) => [l.id, l]));
  readonly trials = new Map<string, TrialRun>();
  readonly watches = new Map<string, WatchRun>();
  private queue: Promise<unknown> = Promise.resolve();

  remember(ls: Listing[]) { for (const l of ls) if (!this.listings.has(l.id)) this.listings.set(l.id, l); }

  /** Resolve a listing (and optionally a specific version) from memory or the registry. */
  async resolveListing(id: string, version?: string): Promise<Listing> {
    const known = this.listings.get(id);
    if (known && (!version || known.version === version || known.lab)) return known;
    const versions = await fetchVersions(id);
    const hit = version ? versions.find((v) => v.version === version) : versions.at(-1);
    if (!hit) throw new Error(`${id}${version ? `@${version}` : ""} not found in the registry`);
    return hit;
  }

  startTrial(listing: Listing, version?: string): TrialRun {
    const run: TrialRun = { id: newId("trial"), listing, version: version ?? listing.version, stream: new Stream() };
    this.trials.set(run.id, run);
    run.stream.push({ type: "stage", stage: "queued", text: `queued ${listing.title}@${run.version}` });
    const job = this.queue.then(() => this.execute(run)).catch((e) => {
      run.stream.push({ type: "error", message: (e as Error).message });
    }).finally(() => run.stream.end());
    this.queue = job;
    return run;
  }

  private async execute(run: TrialRun): Promise<void> {
    const { listing, version } = run;
    const declaredHosts = declaredDomains(listing);
    // scan() flags any request carrying bait; a request to the listing's own declared service, or one that stays on
    // loopback, isn't a leak, so it's re-labelled `own` here and never drawn in red.
    const local = (host: string) => declaredHosts.has(rootDomain(hostOf(host))) || isLoopback(host);
    const push = (e: LabEvent) => run.stream.push(
      e.type === "egress" && e.bait && local(e.host) ? { ...e, bait: false, own: true }
        : e.type === "finding" ? { ...e, finding: { ...e.finding, expected: e.finding.channel === "egress" && local(e.finding.destination) } }
          : e,
    );
    const started = new Date();
    let result;
    let runnerName: "local" | "sandbox" = "local";
    let sandboxKind: TrialRecord["sandbox"];

    if (listing.integration) return this.executeIntegration(run, started);
    if (listing.lab) {
      push({ type: "stage", stage: "run", text: "planted test case · running locally behind the sinkhole proxy" });
      result = await scan({
        command: "node", args: nodeArgs(listing.lab.entry),
        runner: localRunner(process.execPath, nodeArgs(listing.lab.entry), listing.lab.envVersion ? { MOLE_FIXTURE_VERSION: version } : {}, [listing.lab.entry]),
        onEvent: push,
      });
    } else {
      if (!listing.runnable || !listing.pkg) throw new Error(`not runnable: ${listing.runnableNote}`);
      runnerName = "sandbox";
      const pkg = listing.pkg;
      const docker = await dockerStatus();
      if (docker.docker && docker.image) {
        sandboxKind = "docker";
        push({ type: "stage", stage: "install", text: `npm install ${pkg.identifier}@${pkg.version} · scripts disabled · in a container` });
        const inst = await installPackage(pkg.identifier, pkg.version, (line) => push({ type: "log", text: line }));
        push({ type: "stage", stage: "run", text: "sandbox up · no network · observer attached" });
        result = await scan({
          command: "docker", args: [], runner: sandboxRunner(inst), baitEnvNames: pkg.requiredEnv, onEvent: push,
        });
      } else if (microvmAvailable()) {
        sandboxKind = "microvm";
        const used = this.record.all().filter((r) => r.sandbox === "microvm" && Date.parse(r.startedAt) > Date.now() - 3600_000).length;
        if (used >= MICROVM_PER_HOUR) throw new Error(`this demo's sandbox budget is used for the hour (${MICROVM_PER_HOUR} microVM trials). The planted cases still run.`);
        result = await microvmScan({ npm: { pkg: pkg.identifier, version: pkg.version } }, pkg.requiredEnv, {
          stage: (stage, text) => push({ type: "stage", stage, text }),
          log: (text) => push({ type: "log", text }),
          event: push,
        });
      } else {
        throw new Error("no sandbox on this host: start Docker, or set VERCEL_OIDC_TOKEN for Vercel Sandbox microVMs");
      }
    }

    const findings: RecordedFinding[] = result.findings.map((f) => ({
      ...f, expected: f.channel === "egress" && (declaredHosts.has(rootDomain(hostOf(f.destination))) || isLoopback(f.destination)),
    }));
    const { verdict, summary } = verdictFor(findings, result);

    const record: TrialRecord = {
      id: run.id, listingId: listing.id, title: listing.title, version, kind: listing.kind, lab: !!listing.lab,
      runner: runnerName, sandbox: sandboxKind, startedAt: started.toISOString(), durationMs: result.durationMs, verdict, summary,
      toolsFound: result.toolsFound, toolNames: result.toolNames, probes: result.probes,
      egress: run.stream.events.filter((e) => e.type === "egress").length,
      baitPlanted: (run.stream.events.find((e) => e.type === "bait") as { items: unknown[] } | undefined)?.items.length ?? 0,
      findings: findings.map((f) => {
        const shown = run.stream.events.find((e) => e.type === "finding" && e.finding.canaryId === f.canaryId && e.finding.destination === f.destination) as { finding: RecordedFinding } | undefined;
        return { ...f, matched: shown?.finding.matched ?? "", evidence: shown?.finding.evidence ?? "" };
      }),
      source: result.source?.files ? { files: result.source.files, lines: result.source.lines } : undefined,
      error: result.error,
      package: listing.pkg?.identifier,
    };
    this.record.add(record);
    run.record = record;
    push({ type: "stage", stage: "verdict", text: summary });
    push({ type: "verdict", record });
  }

  /** An integration trial: the bait tenant, the integration's declared job, and what it read and sent. */
  private async executeIntegration(run: TrialRun, started: Date): Promise<void> {
    const { listing, version } = run;
    const spec = listing.integration!;
    run.stream.push({ type: "stage", stage: "run", text: `planted integration · bait tenant up · task: ${spec.task}` });
    const r = await runIntegration(listing, version, (e) => run.stream.push(e as LabEvent));
    const record: TrialRecord = {
      id: run.id, listingId: listing.id, title: listing.title, version, kind: listing.kind, lab: !!listing.lab,
      runner: "local", startedAt: started.toISOString(), durationMs: r.durationMs, verdict: r.verdict, summary: r.summary,
      toolsFound: 1, toolNames: [spec.task], probes: r.apiCalls, egress: r.egress, baitPlanted: r.baitPlanted,
      findings: r.findings, error: r.error, overreach: r.overreach, apiCalls: r.apiCalls,
    };
    this.record.add(record);
    run.record = record;
    run.stream.push({ type: "stage", stage: "verdict", text: r.summary });
    run.stream.push({ type: "verdict", record });
  }

  /** Release watch: trial each published version, oldest first. */
  async startWatch(listingId: string, maxVersions = 6): Promise<WatchRun> {
    const w: WatchRun = { id: newId("watch"), listingId, stream: new Stream() };
    this.watches.set(w.id, w);
    const base = this.listings.get(listingId);
    let targets: { listing: Listing; version: string }[];
    if (base?.lab) targets = base.lab.versions.map((v) => ({ listing: base, version: v }));
    else {
      // Hosted, a watch streams in one function invocation (max 300s) and each version boots its own microVM.
      const cap = process.env.VERCEL ? Math.min(maxVersions, 3) : maxVersions;
      const versions = (await fetchVersions(listingId)).filter((l) => l.runnable).slice(-cap);
      if (!versions.length) throw new Error("no runnable published versions to watch");
      targets = versions.map((l) => ({ listing: l, version: l.version }));
    }
    const title = targets[0]!.listing.title;
    w.stream.push({ type: "watch-start", listingId, title, versions: targets.map((t) => t.version) });

    (async () => {
      let firstCaught: string | undefined;
      for (const t of targets) {
        const trial = this.startTrial(t.listing, t.version);
        w.stream.push({ type: "watch-trial", version: t.version, trialId: trial.id });
        await new Promise<void>((done) => {
          if (trial.stream.done) return done();
          const off = trial.stream.subscribe((e) => { if (e === undefined) { off(); done(); } });
        });
        const r = trial.record;
        if (r) {
          if (r.verdict === "caught" && !firstCaught) firstCaught = t.version;
          w.stream.push({ type: "watch-result", version: t.version, trialId: trial.id, verdict: r.verdict, summary: r.summary });
        }
      }
      w.stream.push({ type: "watch-done", firstCaught });
      w.stream.end();
    })().catch((e) => { w.stream.push({ type: "error", message: (e as Error).message }); w.stream.end(); });
    return w;
  }

  /** The install gate: what an agent gets back when it asks to install a tool. */
  gate(listingId: string, version?: string) {
    const listing = this.listings.get(listingId);
    const v = version ?? listing?.version;
    const t = this.record.latest(listingId, v);
    if (!t) return { decision: "hold" as const, listingId, version: v, reason: "never trialed: held until Mole runs it", trialId: null };
    if (t.verdict === "caught") {
      const f = t.findings.find((x) => !x.expected)!;
      return { decision: "block" as const, listingId, version: t.version, reason: `caught leaking ${f.canaryLabel.toLowerCase()} to ${f.destination}`, trialId: t.id };
    }
    if (t.verdict === "inconclusive" || t.verdict === "overreach") return { decision: "hold" as const, listingId, version: t.version, reason: t.summary, trialId: t.id };
    return { decision: "allow" as const, listingId, version: t.version, reason: t.summary, trialId: t.id };
  }
}

/** A small, measured badge (shields-style SVG): what the record says about listing@version. */
export function badgeSvg(label: string, verdict: Verdict | "untested", version?: string): string {
  const right = `${verdict === "untested" ? "untested" : verdict}${version ? ` ${version}` : ""}`;
  const w1 = 6 * label.length + 20;
  const w2 = 6.6 * right.length + 20;
  // Same palette as the lab UI: paper + ink, and red only for a measured leak.
  const bg = verdict === "caught" ? "#C62A14" : verdict === "cleared" ? "#16161A" : "#D9D6CE";
  const fg = verdict === "caught" || verdict === "cleared" ? "#FFFFFF" : "#16161A";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w1 + w2}" height="22" role="img" aria-label="${esc(label)}: ${esc(right)}">
<rect width="${w1 + w2}" height="22" rx="4" fill="#EFEDE7"/><rect x="${w1}" width="${w2}" height="22" rx="4" fill="${bg}"/><rect x="${w1}" width="4" height="22" fill="${bg}"/>
<g font-family="ui-monospace,Menlo,monospace" font-size="11" font-weight="600">
<text x="10" y="15" fill="#16161A">${esc(label)}</text><text x="${w1 + 10}" y="15" fill="${fg}">${esc(right.toUpperCase())}</text></g></svg>`;
}
