/**
 * Projects the ordered event bus into small, typed Keewano events (one entity = one agent session) and ships them.
 * Keewano wants typed events, not logs, so we emit categories (ToolCalled("send_email"), TripFired("secret")) and keep
 * full detail in our own event bus. This is what powers the live cross-run fleet query in the demo.
 */
import type { AgentEvent } from "@tripwire/canary-core";
import type { KeewanoAdapter, KwEvent } from "@tripwire/adapters";
import type { AgentSpec } from "./types.js";
import type { AgentWorld } from "@tripwire/orchestrator";

export function projectEvents(spec: AgentSpec, world: AgentWorld, events: AgentEvent[]): KwEvent[] {
  const out: KwEvent[] = [];
  const ts = (e: AgentEvent) => Math.floor(new Date(e.ts).getTime() / 1000);
  let i = 0;
  out.push({ name: "AgentRole", value: spec.role, ts: Math.floor(Date.now() / 1000) });
  out.push({ name: "AgentModel", value: spec.model, ts: Math.floor(Date.now() / 1000) });
  out.push({ name: "Fleet", value: "support-desk", ts: Math.floor(Date.now() / 1000) });
  if (spec.skill) out.push({ name: "SkillLoaded", value: spec.skill.name, ts: Math.floor(Date.now() / 1000) });
  for (const e of events) {
    if (e.kind === "tool_call" && e.tool) out.push({ name: "ToolCalled", value: e.tool, ts: ts(e) });
    if (e.kind === "canary_exposed") {
      const cid = e.canaryIds?.[0];
      const c = world.canaries.find((k) => k.id === cid);
      if (c) out.push({ name: "CanaryExposed", value: c.type, ts: ts(e) });
    }
    if (e.kind === "trip") {
      out.push({ name: "TripFired", value: String((e.data?.category as string) ?? "trip"), ts: ts(e) });
      out.push({ name: "TripActor", value: e.actor, ts: ts(e) });
    }
    if (e.kind === "breaker") out.push({ name: "BreakerThrown", value: spec.role, ts: ts(e) });
    out.push({ name: "StepIndex", value: ++i, ts: ts(e) });
  }
  return out;
}

export async function shipToKeewano(kw: KeewanoAdapter, runId: string, spec: AgentSpec, world: AgentWorld, events: AgentEvent[]) {
  const entity = `${runId}:${spec.id}`;
  return kw.ingest(entity, projectEvents(spec, world, events));
}
