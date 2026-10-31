/**
 * The lab behind the live demo: registry parsing, "own service" attribution, the observer log, the record, the gate,
 * the badge, and (end to end, really executed) the mailer-mcp release flip at 1.0.16.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { maskPhone, redactSecrets, redactSecretValue } from "../src/format.js";
import { Lab, LAB_LISTINGS, badgeSvg } from "../src/lab/lab.js";
import { RecordStore, type TrialRecord } from "../src/lab/record.js";
import { declaredDomains, normalize, rootDomain } from "../src/lab/registry.js";
import { readEgress } from "../src/lab/sandbox.js";

// Built at runtime so no key-shaped literal sits in the repo for secret scanners to trip on.
const LIVE = ["sk", "live", ""].join("_");
const tmp = mkdtempSync(join(tmpdir(), "mole-lab-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const rec = (o: Partial<TrialRecord>): TrialRecord => ({
  id: "t", listingId: "x/y", title: "y", version: "1.0.0", kind: "npm", lab: false, runner: "sandbox",
  startedAt: new Date().toISOString(), durationMs: 10, verdict: "cleared", summary: "cleared", toolsFound: 1,
  toolNames: ["a"], probes: 1, egress: 0, baitPlanted: 7, findings: [], ...o,
});

describe("redaction", () => {
  it("masks phone numbers to the last two digits, even when passed as a known secret", () => {
    const phone = "+16507005704";
    expect(redactSecretValue(phone)).toBe(maskPhone(phone));
    expect(redactSecretValue(phone).endsWith("04")).toBe(true);
    expect(redactSecretValue(phone)).not.toContain("5704");
    const line = redactSecrets(`Phone: ${phone} key ${LIVE}abcdefghijklmnop`, [phone]);
    expect(line).not.toContain("650700");
    expect(line).not.toContain("abcdefghijklmnop");
  });

  it("keeps a secret's scheme and last four only", () => {
    expect(redactSecretValue(`${LIVE}51HxyzABCDEFGH1234`)).toBe(`${LIVE}…1234`);
  });
});

describe("registry", () => {
  const entry = (pkg: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
    server: { name: "com.acme/widgets", version: "2.0.0", description: "d", packages: pkg ? [pkg] : [], ...extra },
  });

  it("marks npm-over-stdio servers without required args as runnable", () => {
    const l = normalize(entry({ registryType: "npm", identifier: "@acme/widgets", version: "2.0.0", transport: { type: "stdio" },
      environmentVariables: [{ name: "ACME_KEY", isRequired: true }] }) as never);
    expect(l.kind).toBe("npm");
    expect(l.runnable).toBe(true);
    expect(l.pkg?.requiredEnv).toEqual(["ACME_KEY"]);
  });

  it("indexes but does not execute remote servers or servers needing launch args", () => {
    expect(normalize(entry(null, { remotes: [{ type: "streamable-http", url: "https://mcp.acme.com" }] }) as never).runnable).toBe(false);
    const needsArgs = normalize(entry({ registryType: "npm", identifier: "w", transport: { type: "stdio" },
      packageArguments: [{ name: "root", isRequired: true }] }) as never);
    expect(needsArgs.runnable).toBe(false);
    expect(needsArgs.runnableNote).toMatch(/launch arguments/);
  });

  it("treats a listing's website, remotes and reverse-DNS namespace as its own service", () => {
    expect(rootDomain("api.eu.acme.com:443")).toBe("acme.com");
    const l = normalize(entry(null, { websiteUrl: "https://docs.acme.com", remotes: [{ url: "https://mcp.acme.io/x" }] }) as never);
    const d = declaredDomains(l);
    expect(d.has("acme.com")).toBe(true);
    expect(d.has("acme.io")).toBe(true);
    expect(d.has("github.com")).toBe(false);
  });

  it("never treats a github namespace as a declared domain", () => {
    const l = normalize({ server: { name: "io.github.someone/tool", version: "1", packages: [] } } as never);
    expect([...declaredDomains(l)]).toEqual([]);
  });
});

describe("sandbox observer log", () => {
  it("reads complete lines and skips a partial trailing write", () => {
    const f = join(tmp, "egress.jsonl");
    writeFileSync(f, `${JSON.stringify({ at: 1, scheme: "https", method: "POST", url: "https://x.example/a", host: "x.example", body: "hi" })}\n{"at":2,"sch`);
    const reqs = readEgress(f);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ scheme: "https", method: "POST", host: "x.example", body: "hi" });
    expect(readEgress(join(tmp, "missing.jsonl"))).toEqual([]);
  });
});

describe("record, gate, badge", () => {
  it("keeps the latest trial per listing@version and persists to disk", () => {
    const dir = join(tmp, "rec1");
    const r = new RecordStore(dir);
    r.add(rec({ id: "a", version: "1.0.0", startedAt: "2026-01-01T00:00:00Z" }));
    r.add(rec({ id: "b", version: "1.0.0", verdict: "caught", startedAt: "2026-01-02T00:00:00Z" }));
    r.add(rec({ id: "c", version: "1.1.0", startedAt: "2026-01-03T00:00:00Z" }));
    expect(r.index().map((t) => t.id)).toEqual(["c", "b"]);
    expect(r.stats()).toMatchObject({ trials: 3, artifacts: 2, cleared: 1, caught: 1 });
    expect(new RecordStore(dir).latest("x/y", "1.0.0")?.id).toBe("b");
  });

  it("allows cleared versions, blocks caught ones, holds anything untested", () => {
    const store = new RecordStore(join(tmp, "rec2"));
    store.add(rec({ id: "ok", version: "1.0.0" }));
    store.add(rec({ id: "bad", version: "1.0.1", verdict: "caught", findings: [
      { severity: "critical", tool: "send", canaryId: "c1", canaryType: "secret", canaryLabel: "Stripe live key", channel: "egress",
        destination: "evil.example", evidence: "POST …", expected: false },
    ] as TrialRecord["findings"] }));
    const lab = new Lab(store);
    expect(lab.gate("x/y", "1.0.0").decision).toBe("allow");
    expect(lab.gate("x/y", "1.0.1")).toMatchObject({ decision: "block", reason: "caught leaking stripe live key to evil.example" });
    expect(lab.gate("x/y", "9.9.9").decision).toBe("hold");
  });

  it("badges carry the verdict and the exact version, and only a catch is red", () => {
    expect(badgeSvg("mole", "caught", "1.0.16")).toContain("CAUGHT 1.0.16");
    expect(badgeSvg("mole", "caught", "1.0.16")).toContain("#C62A14");
    expect(badgeSvg("mole", "overreach", "3.1.5")).not.toContain("#C62A14"); // overreach is never red
    expect(badgeSvg("mole", "cleared", "1.0.15")).not.toContain("#C62A14");
    expect(badgeSvg("mole", "untested")).toContain("UNTESTED");
  });
});

describe("release watch, really executed", () => {
  it("mailer-mcp clears at 1.0.15 and is caught at 1.0.16", async () => {
    const lab = new Lab(new RecordStore(join(tmp, "rec3")));
    const mailer = LAB_LISTINGS.find((l) => l.id === "lab/mailer-mcp")!;
    const run = async (v: string) => {
      const t = lab.startTrial(mailer, v);
      await new Promise<void>((done) => { if (t.stream.done) done(); else t.stream.subscribe((e) => { if (e === undefined) done(); }); });
      return t.record!;
    };
    const clean = await run("1.0.15");
    const bad = await run("1.0.16");
    expect(clean.verdict).toBe("cleared");
    expect(clean.egress).toBe(0);
    expect(bad.verdict).toBe("caught");
    expect(bad.findings.some((f) => f.destination.includes("mail-relay-audit.example"))).toBe(true);
    // Stored evidence never holds a full bait value.
    expect(JSON.stringify(bad)).not.toMatch(/sk_live_[A-Za-z0-9]{12,}/);
    expect(lab.gate("lab/mailer-mcp", "1.0.15").decision).toBe("allow");
    expect(lab.gate("lab/mailer-mcp", "1.0.16").decision).toBe("block");
  }, 60_000);
});
