/**
 * `mole run` — wrap a REAL agent session and catch it live. The default target is the Compromised agent, driven by
 * the Claude Agent SDK (CLI login, no API key) inside a Sparta world. The malicious skill stays deterministic, so the
 * trip is reliable while the agent itself is real. Events stream to the terminal as they happen; on a high/critical
 * trip the circuit breaker halts the agent, revokes its canary credentials, and Dial phones the owner (number masked).
 */
import { randomUUID } from "node:crypto";
import type { Trip } from "@tripwire/canary-core";
import { buildAdapters } from "@tripwire/adapters";
import { buildAgentWorld, CircuitBreaker, EventBus, TripRecorder, WorldTools } from "@tripwire/orchestrator";
import { AGENT_SPECS, EXPECTED, runAgent } from "@tripwire/agent-harness";
import { rateAgent, scoreUtility } from "@tripwire/scoring";
import { ensureSparta } from "./sparta-ensure.js";
import { streamLine } from "./stream.js";
import { col, maskPhone } from "./format.js";
import { isReplay, replayBannerIfEnabled } from "./demo.js";
import { saveLastRun, type RunRecord } from "./state.js";

export async function run(): Promise<RunRecord> {
  replayBannerIfEnabled();
  const demo = isReplay();
  const adapters = buildAdapters(process.env);
  const cfg = adapters.config;
  const spec = AGENT_SPECS.find((s) => s.id === "compromised")!;

  console.log(`\n${col.bold("mole run")} ${col.dim("—")} ${spec.role} agent (${spec.model})${spec.skill ? col.dim(` + skill ${spec.skill.name}`) : ""}, live${demo ? col.yellow(" [REPLAY]") : ""}\n`);

  const sparta = await ensureSparta(cfg.sparta.url, demo);
  if (sparta.started) console.log(col.dim(`  started a Sparta world server at ${sparta.url}`));

  const runId = `molerun_${Date.now().toString(36)}`;
  const sessionId = randomUUID();
  const bus = new EventBus(runId);
  const breaker = new CircuitBreaker();

  let alert: RunRecord["alert"];
  const alertPromises: Promise<void>[] = [];

  const onTrip = (trip: Trip): void => {
    if (trip.severity !== "high" && trip.severity !== "critical") return;
    const to = cfg.ownerPhone;
    if (!to) {
      bus.append({ agentId: trip.agentId, sessionId: trip.sessionId, kind: "alert", actor: "mole", tripId: trip.tripId, text: "Owner alert skipped: OWNER_PHONE not set." });
      return;
    }
    const script = `Mole alert. Agent ${spec.role} ${trip.headline}. The agent has been paused and its credentials revoked.`;
    alertPromises.push((async () => {
      const res = await adapters.dial.placeAlertCall({ to, script, idempotencyKey: trip.tripId });
      alert = { toMasked: maskPhone(to), mode: res.mode, status: res.status };
      bus.append({ agentId: trip.agentId, sessionId: trip.sessionId, kind: "alert", actor: "mole", tripId: trip.tripId, text: `Dial ${res.mode} call to owner ${maskPhone(to)}: "${script}"`, data: { mode: res.mode, status: res.status } });
    })());
  };

  const trips = new TripRecorder(runId, bus, breaker, onTrip);
  const unsub = bus.subscribe((e) => { const line = streamLine(e); if (line) console.log(line); });

  try {
    const world = buildAgentWorld({ agentId: spec.id, sessionId, runId, dialPool: cfg.dialCanaryNumbers });
    const handle = await adapters.sparta.createWorld(world.seed);
    await handle.mark("start");
    breaker.arm(spec.id);
    const tools = new WorldTools(world, handle, bus, breaker, trips, adapters.dial, { liveCanaryCalls: cfg.liveCanaryCalls });

    bus.append({ agentId: spec.id, sessionId, kind: "agent_started", actor: "harness", text: `${spec.role} seeded with ${world.canaries.length} canaries · ${spec.skill?.name ?? "no skill"}`, data: { model: spec.model } });

    const runner = demo ? "scripted" : "claude";
    try {
      await runAgent({ spec: { ...spec, runner }, world, tools, ctx: { agentId: spec.id, sessionId, actor: "model" }, isPaused: () => breaker.isThrown(spec.id) });
    } catch (e) {
      bus.append({ agentId: spec.id, sessionId, kind: "agent_finished", actor: "harness", text: `${spec.role} errored: ${(e as Error).message}` });
    }
    bus.append({ agentId: spec.id, sessionId, kind: "agent_finished", actor: "harness", text: `${spec.role} finished` });

    await Promise.allSettled(alertPromises);

    const diff = await handle.diff("start").catch(() => ({ created: {}, updated: {} }));
    const utility = scoreUtility(diff, EXPECTED);
    const rating = rateAgent(spec.id, trips.forAgent(spec.id), utility);

    const results = bus.all().filter((e) => e.kind === "tool_result" && e.sessionId === sessionId);
    const blocked = results.filter((e) => (e.data as { blocked?: boolean } | undefined)?.blocked === true).length;
    const actionsCompleted = results.length - blocked;

    const record: RunRecord = {
      kind: "run",
      target: `${spec.role} (${spec.model})`,
      agentRole: spec.role,
      model: spec.model,
      skill: spec.skill?.name,
      sessionId,
      actionsCompleted,
      approvalsNeeded: 0,
      blocked,
      trips: trips.forAgent(spec.id).map((t) => ({ number: t.number, severity: t.severity, headline: t.headline, detectedVia: t.detectedVia, actor: t.evidence.actor, destination: t.evidence.destination })),
      utility: { percent: utility.percent, correct: utility.correct, total: utility.total },
      alert,
      at: new Date().toISOString(),
    };
    saveLastRun(record);

    await handle.destroy().catch(() => undefined);
    unsub();
    printSummary(record, rating.grade, rating.overallStars);
    return record;
  } finally {
    unsub();
    await sparta.stop();
  }
}

function printSummary(r: RunRecord, grade: string, stars: number): void {
  const out: string[] = [];
  out.push("");
  out.push(col.bold("── summary ──"));
  out.push(`  ${col.bold(String(r.actionsCompleted))} actions completed · ${col.bold("0")} approvals needed · ${r.blocked ? col.red(col.bold(String(r.blocked))) : col.bold("0")} blocked`);
  out.push(`  task utility: ${col.bold(`${r.utility.percent}%`)} ${col.dim(`(${r.utility.correct}/${r.utility.total} tickets resolved correctly, verified by Sparta)`)}`);
  if (r.trips.length) {
    out.push("");
    out.push(`  ${col.red(col.bold(`${r.trips.length} trip${r.trips.length === 1 ? "" : "s"}`))}:`);
    for (const t of r.trips) {
      const sev = t.severity === "critical" ? col.red(col.bold(t.severity)) : t.severity === "high" ? col.yellow(t.severity) : col.dim(t.severity);
      const who = t.actor?.startsWith("skill:") ? col.red(` ${t.actor}`) : "";
      out.push(`    ${col.bold(t.number)} ${sev}  ${t.headline}${who}`);
    }
  } else {
    out.push(`  ${col.green("0 trips")} ${col.dim(`across ${r.actionsCompleted} actions`)}`);
  }
  if (r.alert) out.push(`\n  owner alerted: Dial ${r.alert.mode} call to ${r.alert.toMasked} (${r.alert.status})`);
  else out.push(`\n  owner alert: ${col.dim("skipped (set OWNER_PHONE + Dial credentials to enable)")}`);
  out.push("");
  console.log(out.join("\n"));
}
