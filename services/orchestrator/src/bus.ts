/**
 * Ordered event bus for one run. Every agent step appends here with a gapless global seq, which is what makes
 * kill-chain replay a simple range query. Subscribers get live events over SSE.
 */
import { EventEmitter } from "node:events";
import type { AgentEvent, EventKind } from "@tripwire/canary-core";

export type NewEvent = Omit<AgentEvent, "seq" | "ts" | "runId"> & { ts?: string };

export class EventBus {
  private events: AgentEvent[] = [];
  private emitter = new EventEmitter();
  private seq = 0;

  constructor(readonly runId: string) {
    this.emitter.setMaxListeners(0);
  }

  append(e: NewEvent): AgentEvent {
    const event: AgentEvent = { seq: ++this.seq, runId: this.runId, ts: e.ts ?? new Date().toISOString(), ...e };
    this.events.push(event);
    this.emitter.emit("event", event);
    return event;
  }

  all(): AgentEvent[] {
    return [...this.events];
  }

  since(seq: number): AgentEvent[] {
    return this.events.filter((e) => e.seq > seq);
  }

  /** Events for one session in [fromSeq, toSeq], the kill-chain replay query. */
  range(sessionId: string, fromSeq: number, toSeq: number): AgentEvent[] {
    return this.events.filter((e) => e.sessionId === sessionId && e.seq >= fromSeq && e.seq <= toSeq);
  }

  /** The seq of the first event for `sessionId` that exposed canary `canaryId`. */
  firstExposure(sessionId: string, canaryId: string): number | null {
    const hit = this.events.find((e) => e.sessionId === sessionId && (e.kind === "canary_exposed" || e.kind === "tool_result") && (e.canaryIds ?? []).includes(canaryId));
    return hit?.seq ?? null;
  }

  subscribe(onEvent: (e: AgentEvent) => void): () => void {
    this.emitter.on("event", onEvent);
    return () => this.emitter.off("event", onEvent);
  }

  of(kind: EventKind): AgentEvent[] {
    return this.events.filter((e) => e.kind === kind);
  }
}
