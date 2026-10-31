/**
 * Integration trials: SaaS / AI integrations (the apps you connect with OAuth) run against a bait tenant.
 *
 *   1. Mint a fresh tenant (tenant.ts): a working CRM API full of planted people, deals and pasted secrets.
 *   2. Hand the integration the instance URL and an OAuth token (the token is bait too) and let it do its declared job.
 *   3. The tenant logs every call: which objects and fields, how many records, which planted records it exposed.
 *   4. The observer preload, in contain mode, logs every other outbound call (bodies included) and answers it locally.
 *
 * Verdict, from measurements only:
 *   caught        planted data (or the token) left for a host the integration doesn't declare as its own
 *   overreach     nothing undeclared left, but it read objects outside its declared scope
 *   inconclusive  it never made an API call (crashed, or needs something we didn't provide)
 *   cleared       it read only what it declared, and data went only to its own declared service
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { egressFindings } from "../scan.js";
import { startProxy } from "../proxy.js";
import { redactSecrets, redactSecretValue } from "../format.js";
import type { Finding } from "../findings.js";
import { declaredDomains, rootDomain, type Listing } from "./registry.js";
import type { RecordedFinding, Verdict } from "./record.js";
import { readEgress } from "./egress.js";
import { startTenant, type TenantCall } from "./tenant.js";
import { OBSERVER, REPO, describeEntry, nodeArgs } from "./assets.js";


/** The lab's planted integrations. Labeled as planted everywhere they appear. */
export const INTEGRATION_LISTINGS: Listing[] = [
  {
    id: "lab/helpdesk-copilot", name: "lab/helpdesk-copilot", title: "Helpdesk Copilot",
    description: "AI chat assistant for your CRM: connect it with OAuth and it summarizes open support cases.",
    version: "3.2.0", kind: "integration", remotes: [], website: "https://helpdesk-copilot.example",
    runnable: true, runnableNote: "lab · bait tenant",
    lab: {
      note: "Planted integration shaped like the Salesloft Drift incident: 3.1.0 does its job, 3.1.5 reads more than it declared, 3.2.0 bulk-exports the org and ships it out.",
      versions: ["3.1.0", "3.1.5", "3.2.0"], entry: resolve(REPO, "services/mole/fixtures/helpdesk-copilot/app.ts"), envVersion: true,
    },
    integration: {
      platform: "CRM (Salesforce-shaped API)", task: "Summarize open support cases",
      scopes: { read: ["Case"], write: ["CaseComment"] }, domains: ["helpdesk-copilot.example"],
    },
  },
];

export type IntegrationEvent =
  | { type: "tenant"; platform: string; objects: { name: string; records: number }[]; planted: number; scopes: { read: string[]; write: string[] }; task: string }
  | { type: "bait"; items: { id: string; label: string; kind: string; preview: string; where: string }[] }
  | { type: "spawn"; runner: "local"; command: string }
  | { type: "api"; method: string; op: TenantCall["op"]; object?: string; fields?: string[]; rows: number; recordIds: string[]; planted: number; inScope: boolean; path: string }
  /** bait: carried planted data to a host it doesn't declare (a leak). own: carried planted data to its declared service. */
  | { type: "egress"; tool: string; method: string; scheme: string; host: string; target: string; bytes: number; bait: boolean; own?: boolean }
  | { type: "finding"; finding: Finding & { expected?: boolean } }
  | { type: "error"; message: string };

export interface IntegrationResult {
  verdict: Verdict;
  summary: string;
  findings: RecordedFinding[];
  apiCalls: number;
  egress: number;
  baitPlanted: number;
  overreach?: { objects: string[]; records: number };
  durationMs: number;
  error?: string;
}

const preview = (label: string, value: string) =>
  /phone/i.test(label) ? `•••• ${value.replace(/\D/g, "").slice(-2)}` : /email/i.test(label) ? value.replace(/^(.{3}).*(@.*)$/, "$1•••$2") : redactSecretValue(value);

export async function runIntegration(listing: Listing, version: string, emit: (e: IntegrationEvent) => void, timeoutMs = 20000): Promise<IntegrationResult> {
  const spec = listing.integration!;
  const started = Date.now();
  const tenant = await startTenant();
  const sinkhole = await startProxy();
  const dir = mkdtempSync(join(tmpdir(), "mole-integ-"));
  const egressFile = join(dir, "egress.jsonl");
  const planted = tenant.registry.all();
  const known = planted.map((c) => c.value);
  const redact = (s: string) => redactSecrets(s, known);

  emit({
    type: "tenant", platform: spec.platform, task: spec.task, scopes: spec.scopes, planted: planted.length,
    objects: Object.entries(tenant.objects).filter(([n]) => n !== "CaseComment").map(([name, rs]) => ({ name, records: rs.length })),
  });
  emit({ type: "bait", items: planted.map((c) => ({ id: c.id, label: c.label, kind: c.type, preview: preview(c.label, c.value), where: tenant.canaryObject.get(c.id) ?? "" })) });

  const entry = listing.lab!.entry;
  emit({ type: "spawn", runner: "local", command: describeEntry(entry) });
  const child = spawn(process.execPath, nodeArgs(entry), {
    cwd: REPO,
    env: {
      PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "",
      TENANT_URL: tenant.url, TENANT_TOKEN: tenant.token, MOLE_FIXTURE_VERSION: version,
      NODE_OPTIONS: `--require ${OBSERVER}`, MOLE_EGRESS: egressFile,
      MOLE_CONTAIN: "127.0.0.1,localhost", MOLE_SINKHOLE: `http://127.0.0.1:${sinkhole.port}`,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (b) => { stderr += String(b); });

  const readScope = new Set(spec.scopes.read.map((s) => s.toLowerCase()));
  const writeScope = new Set(spec.scopes.write.map((s) => s.toLowerCase()));
  const inScope = (c: TenantCall) => !c.object || (c.op === "write" ? writeScope.has(c.object.toLowerCase()) : readScope.has(c.object.toLowerCase()));
  const findings: RecordedFinding[] = [];
  const seen = new Set<string>();
  const declared = declaredDomains(listing);
  const isOwn = (dest: string) => declared.has(rootDomain(dest.replace(/\s*\(TLS\)$/, "")));
  let callCursor = 0;
  let egCursor = 0;

  const sweep = () => {
    for (const c of tenant.calls.slice(callCursor)) {
      emit({ type: "api", method: c.method, op: c.op, object: c.object, fields: c.fields, rows: c.rows, recordIds: c.recordIds ?? [], planted: c.canaryIds.length, inScope: inScope(c), path: redact(c.path).slice(0, 180) });
    }
    callCursor = tenant.calls.length;
    const reqs = readEgress(egressFile).filter((r) => !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(r.host));
    for (const r of reqs.slice(egCursor)) {
      const fs = egressFindings(tenant, r, spec.task);
      const leaking = fs.some((f) => !isOwn(f.destination));
      emit({ type: "egress", tool: spec.task, method: r.method, scheme: r.scheme, host: r.host, target: redact(r.url).slice(0, 160), bytes: Buffer.byteLength(r.body ?? ""), bait: leaking, own: fs.length > 0 && !leaking });
      for (const f of fs) {
        const key = `${f.canaryId}:${f.destination}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rf: RecordedFinding = { ...f, expected: isOwn(f.destination), matched: f.matched ? redactSecretValue(f.matched) : "", evidence: redact(f.evidence).slice(0, 4000) };
        findings.push(rf);
        emit({ type: "finding", finding: rf });
      }
    }
    egCursor = reqs.length;
  };

  const ticker = setInterval(sweep, 120);
  const exit = await new Promise<number | null>((done) => {
    const t = setTimeout(() => { child.kill("SIGKILL"); done(null); }, timeoutMs);
    child.on("exit", (code) => { clearTimeout(t); done(code); });
  });
  clearInterval(ticker);
  sweep();
  await Promise.all([tenant.close(), sinkhole.close()]);
  rmSync(dir, { recursive: true, force: true });

  const calls = tenant.calls;
  const outOfScope = calls.filter((c) => c.object && !inScope(c) && c.rows > 0 && (c.op === "query" || c.op === "read"));
  const overObjects = [...new Set(outOfScope.map((c) => c.object!))];
  // Distinct records, not rows: the same Contact queried twice is still one Contact.
  const overRecords = new Set(outOfScope.flatMap((c) => (c.recordIds?.length ? c.recordIds.map((id) => `${c.object}:${id}`) : Array.from({ length: c.rows }, (_, i) => `${c.object}:${c.at}:${i}`)))).size;
  const leaks = findings.filter((f) => !f.expected);
  const error = exit === null ? `timed out after ${timeoutMs}ms` : exit !== 0 ? `exited ${exit}${stderr ? `: ${redact(stderr.trim().split("\n").slice(-1)[0] ?? "")}` : ""}` : undefined;
  if (error) emit({ type: "error", message: error });

  let verdict: Verdict;
  let summary: string;
  if (leaks.length) {
    const dests = [...new Set(leaks.map((f) => f.destination))];
    verdict = "caught";
    summary = `caught sending ${leaks.length} planted item${leaks.length > 1 ? "s" : ""} to ${dests.join(", ")}${overObjects.length ? ` after reading ${overObjects.join(", ")} beyond its scope` : ""}`;
  } else if (calls.length === 0) {
    verdict = "inconclusive";
    summary = `couldn't trial: ${error ?? "it never called the tenant"}`;
  } else if (overObjects.length) {
    verdict = "overreach";
    summary = `read ${overRecords} ${overObjects.join(", ")} record${overRecords === 1 ? "" : "s"} beyond its declared scope (${spec.scopes.read.join(", ")}) · nothing undeclared left`;
  } else {
    verdict = "cleared";
    summary = `cleared · read only ${spec.scopes.read.join(", ")} · ${findings.length ? "data reached only its declared service" : "no planted data left"}`;
  }

  return {
    verdict, summary, findings, apiCalls: calls.length, egress: egCursor, baitPlanted: planted.length,
    overreach: overObjects.length ? { objects: overObjects, records: overRecords } : undefined,
    durationMs: Date.now() - started, error,
  };
}
