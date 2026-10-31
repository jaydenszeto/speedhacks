/**
 * The microVM runner (Vercel Sandbox), used where there's no Docker (the hosted demo).
 *
 *   always        the pure parts: line framing, runner protocol, bin resolution, the spec guard, the runner bundle
 *                 actually building, and loopback classification (a server talking to its own localhost backend
 *                 inside a sealed VM is not a leak; stored records are re-derived under that rule)
 *   with a token  real microVMs (needs VERCEL_OIDC_TOKEN, e.g. `vercel env pull .env.local` and source it):
 *                 a planted exfiltrating server is CAUGHT inside a deny-all VM, and a real registry package
 *                 (@modelcontextprotocol/server-memory) installs from npm and clears
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import type { ScanEvent } from "../src/scan.js";
import { bundleOptions } from "../src/lab/bundle.js";
import { binFromPackageJson, safeSpec } from "../src/lab/egress.js";
import { lineSplitter, microvmScan, parseRunnerLine, runnerBundle, type MicrovmHooks } from "../src/lab/microvm.js";
import { RecordStore, hostOf, isLoopback, reclassify, verdictFor, type RecordedFinding, type TrialRecord } from "../src/lab/record.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = fileURLToPath(new URL(".", import.meta.url));

describe("microVM runner · protocol", () => {
  it("reassembles lines across arbitrary chunk boundaries", () => {
    const got: string[] = [];
    const s = lineSplitter((l) => got.push(l));
    s.push("@@mole {\"ev");
    s.push("ent\":1}\nplain out");
    s.push("put\n@@mole {\"result\":2}");
    s.flush();
    expect(got).toEqual(["@@mole {\"event\":1}", "plain output", "@@mole {\"result\":2}"]);
  });

  it("parses only marked lines, and survives garbage", () => {
    expect(parseRunnerLine("@@mole {\"event\":{\"type\":\"connected\",\"ms\":5}}")?.event).toEqual({ type: "connected", ms: 5 });
    expect(parseRunnerLine("@@mole {\"result\":{\"probes\":3}}")?.result).toEqual({ probes: 3 });
    expect(parseRunnerLine("server says hi")).toBeUndefined();
    expect(parseRunnerLine("@@mole {not json")).toBeUndefined();
  });

  it("resolves the server entry the way npm would", () => {
    expect(binFromPackageJson({ bin: "./dist/index.js" }, "@scope/srv")).toBe("node_modules/@scope/srv/dist/index.js");
    expect(binFromPackageJson({ bin: { other: "a.js", srv: "b.js" } }, "@scope/srv")).toBe("node_modules/@scope/srv/b.js");
    expect(binFromPackageJson({ bin: { only: "./x/y.js" } }, "srv")).toBe("node_modules/srv/x/y.js");
    expect(binFromPackageJson({ main: "lib/main.js" }, "srv")).toBe("node_modules/srv/lib/main.js");
    expect(binFromPackageJson({}, "srv")).toBeUndefined();
  });

  it("refuses package specs that could escape the install command", () => {
    expect(safeSpec("@modelcontextprotocol/server-memory", "2.0.1")).toBe(true);
    expect(safeSpec("srv", "1.0.0-beta.1+build")).toBe(true);
    expect(safeSpec("srv\"; curl evil", "1.0.0")).toBe(false);
    expect(safeSpec("srv", "1.0.0 && rm -rf /")).toBe(false);
    expect(safeSpec("../srv", "1.0.0")).toBe(false);
  });

  it("bundles the in-VM runner into one plain-JS file", async () => {
    const js = (await runnerBundle()).toString("utf8");
    expect(js.length).toBeGreaterThan(10_000);
    expect(js).toContain("@@mole ");
    expect(js).not.toMatch(/from ["']tsx/);
  }, 60_000);
});

const finding = (destination: string, channel: "egress" | "collector" = "egress", expected = false): RecordedFinding => ({
  severity: "critical", tool: "t", canaryId: "C1", canaryType: "secret", canaryLabel: "Stripe live key", channel, destination,
  matched: "", evidence: "", expected,
} as RecordedFinding);

describe("loopback classification", () => {
  it("normalizes destinations to a host", () => {
    expect(hostOf("127.0.0.1:5100")).toBe("127.0.0.1");
    expect(hostOf("api.example.com:443 (TLS)")).toBe("api.example.com");
    expect(hostOf("[::1]:8080")).toBe("::1");
    expect(hostOf("LOCALHOST")).toBe("localhost");
  });

  it("treats only loopback as local", () => {
    for (const h of ["127.0.0.1:5100", "127.9.9.9", "localhost:3000", "[::1]:80", "0.0.0.0:8000"]) expect(isLoopback(h)).toBe(true);
    for (const h of ["10.0.0.1", "192.168.1.5:80", "127.0.0.1.evil.com", "localhost.evil.com", "evil.example"]) expect(isLoopback(h)).toBe(false);
  });

  it("clears bait that only reached localhost, but still catches a call-home and anything off-box", () => {
    const base = { toolsFound: 4, probes: 4 };
    expect(verdictFor([finding("127.0.0.1:5100", "egress", true)], base)).toEqual({ verdict: "cleared", summary: "cleared · 4 probes · bait only reached localhost, inside the sealed sandbox" });
    expect(verdictFor([], base).summary).toBe("cleared · 4 probes · bait untouched");
    expect(verdictFor([finding("evil.example")], base)).toMatchObject({ verdict: "caught", summary: "caught sending 1 bait item to evil.example" });
    expect(verdictFor([], { toolsFound: 0, probes: 0, error: "Connection closed" })).toEqual({ verdict: "inconclusive", summary: "couldn't trial: Connection closed" });
  });

  it("re-derives stored sandbox trials under the loopback rule, and never invents a catch", () => {
    const old: TrialRecord = {
      id: "trial_x", listingId: "ai.example/mem", title: "mem", version: "0.1.0", kind: "npm", lab: false, runner: "sandbox",
      startedAt: "2026-10-31T00:00:00.000Z", durationMs: 1, verdict: "caught", summary: "caught sending 2 bait items to 127.0.0.1:5100",
      toolsFound: 3, toolNames: [], probes: 3, egress: 2, baitPlanted: 9,
      findings: [finding("127.0.0.1:5100"), finding("127.0.0.1:5100", "collector")],
    };
    // A collector hit is a real call-home even though the collector listens on loopback: stays caught.
    expect(reclassify(old).verdict).toBe("caught");
    const localOnly = { ...old, findings: [finding("127.0.0.1:5100")] };
    expect(reclassify(localOnly)).toMatchObject({ verdict: "cleared", findings: [{ expected: true }] });
    // Off-box leaks and lab cases are untouched.
    const offBox = { ...old, findings: [finding("evil.example")] };
    expect(reclassify(offBox)).toBe(offBox);
    expect(reclassify({ ...localOnly, runner: "local" }).verdict).toBe("caught");

    const dir = mkdtempSync(join(tmpdir(), "mole-rc-"));
    try {
      const store = new RecordStore(dir);
      store.merge([localOnly]);
      expect(store.get("trial_x")?.verdict).toBe("cleared");
      expect(new RecordStore(dir).get("trial_x")?.verdict).toBe("cleared");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

const live = !!process.env.VERCEL_OIDC_TOKEN && process.env.MOLE_MICROVM !== "0";

function collect() {
  const events: ScanEvent[] = [];
  const stages: string[] = [];
  const hooks: MicrovmHooks = { stage: (_s, t) => stages.push(t), log: () => undefined, event: (e) => events.push(e) };
  return { events, stages, hooks };
}

describe.skipIf(!live)("microVM runner · real Vercel Sandbox", () => {
  it("catches a planted exfiltrating server inside a deny-all microVM", async () => {
    const out = await build({ ...bundleOptions, entryPoints: [resolve(HERE, "../fixtures/billing-helper-mcp/server.ts")], write: false, outfile: join(HERE, "server.mjs") });
    const { events, stages, hooks } = collect();
    const r = await microvmScan({ bundle: { name: "server.mjs", content: Buffer.from(out.outputFiles[0]!.contents) } }, [], hooks);
    expect(stages.some((s) => s.includes("deny-all"))).toBe(true);
    expect(r.toolsFound).toBeGreaterThan(0);
    expect(r.findings.length).toBeGreaterThan(0);
    // The raw bait never crosses the wire; the redacted copy rides on the finding events.
    expect(r.findings.every((f) => f.matched === "" && f.evidence === "")).toBe(true);
    expect(events.some((e) => e.type === "egress" && e.bait)).toBe(true);
    expect(events.some((e) => e.type === "spawn" && e.runner === "sandbox")).toBe(true);
  }, 240_000);

  it("installs a real registry server from npm and trials every tool", async () => {
    const { events, hooks } = collect();
    const r = await microvmScan({ npm: { pkg: "@modelcontextprotocol/server-memory", version: "2.0.1" } }, [], hooks);
    expect(r.error).toBeUndefined();
    expect(r.toolsFound).toBeGreaterThan(3);
    expect(r.probes).toBe(r.toolsFound);
    expect(r.findings).toEqual([]);
    expect(events.filter((e) => e.type === "probe-done")).toHaveLength(r.probes);
  }, 240_000);
});
