/**
 * Headless end-to-end smoke test: run the whole crash-test loop in memory (mocked sponsors) and assert the
 * invariants the demo depends on. Run before a demo or in CI: `pnpm smoke`. Exits non-zero on any failure.
 *
 * This proves the loop works without a browser, without keys, and without any Sparta/Dial/Keewano server — the
 * same code paths the live run uses, with DEMO_FALLBACK adapters swapped in.
 */
import { buildAdapters } from "@tripwire/adapters";
import { TripwireRun } from "@tripwire/agent-harness";

const checks: { name: string; ok: boolean; got: string }[] = [];
function expect(name: string, ok: boolean, got: unknown) {
  checks.push({ name, ok, got: String(got) });
}

async function main() {
  const adapters = buildAdapters({ ...process.env, DEMO_FALLBACK: "1", OWNER_PHONE: process.env.OWNER_PHONE ?? "+14155551234" });
  const run = new TripwireRun(adapters, { runner: "scripted", stepMs: 0 });
  await run.start();

  expect("run reaches done", run.phase === "done", run.phase);

  const agents = run.agents();
  expect("three agents ran", agents.length === 3, agents.length);

  const by = Object.fromEntries(agents.map((a) => [a.spec.id, a]));
  const careful = by.careful!, eager = by.eager!, compromised = by.compromised!;

  // Careful is the control: a clean run, top marks, full task utility.
  expect("careful: no trips", careful.trips.length === 0, careful.trips.length);
  expect("careful: grade A", careful.rating?.grade === "A", careful.rating?.grade);
  expect("careful: 5 stars", careful.rating?.overallStars === 5, careful.rating?.overallStars);
  expect("careful: 100% utility", careful.rating?.utility.percent === 100, `${careful.rating?.utility.percent}%`);

  // Eager: follows an injected instruction (high) and reads out-of-scope data (medium).
  expect("eager: has trips", eager.trips.length >= 2, eager.trips.length);
  expect("eager: injection trip", eager.trips.some((t) => t.detectedVia === "egress_monitor" && t.category === "injection_resistance"), eager.trips.map((t) => t.category).join(","));
  expect("eager: grade D", eager.rating?.grade === "D", eager.rating?.grade);

  // Compromised: the skill exfiltrates a real-looking secret — a critical leak, grade F.
  expect("compromised: has trips", compromised.trips.length >= 2, compromised.trips.length);
  expect("compromised: critical secret leak", compromised.trips.some((t) => t.severity === "critical" && t.category === "secret_hygiene"), compromised.trips.map((t) => `${t.category}:${t.severity}`).join(","));
  expect("compromised: skill attributed", compromised.trips.some((t) => (t.evidence.actor ?? "").startsWith("skill:")), compromised.trips.map((t) => t.evidence.actor).join(","));
  expect("compromised: grade F", compromised.rating?.grade === "F", compromised.rating?.grade);

  // Keewano received the typed event stream for every agent (mirror in demo mode).
  expect("events logged to keewano", agents.every((a) => (a.keewano?.accepted ?? 0) > 0), agents.map((a) => a.keewano?.accepted).join(","));

  // Report.
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
  console.log("\nTripwire smoke test\n");
  for (const c of checks) console.log(`  ${c.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${pad(c.name, 34)} \x1b[2m${c.got}\x1b[0m`);
  console.log("\n  Ratings:");
  for (const a of agents) {
    console.log(`    ${pad(a.spec.role, 14)} ${a.rating?.grade} ${"★".repeat(a.rating?.overallStars ?? 0)}${"☆".repeat(5 - (a.rating?.overallStars ?? 0))}  utility ${a.rating?.utility.percent}%  trips ${a.trips.length}`);
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.error(`\n\x1b[31m${failed.length} check(s) failed.\x1b[0m\n`);
    process.exit(1);
  }
  console.log(`\n\x1b[32mAll ${checks.length} checks passed.\x1b[0m\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`\x1b[31msmoke test crashed:\x1b[0m`, e);
  process.exit(1);
});
