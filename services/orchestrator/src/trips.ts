/**
 * Trip recorder. Mints stable TRP-#### numbers, attributes each trip to (agent, session, placement), computes the
 * kill-chain event range, throws the circuit breaker and fires the owner alert. One trip per (agent, canary); an
 * over-limit refund keys on its charge. Later interactions enrich evidence but never double-count.
 */
import type { Category, DetectedVia, Trip, TripEvidence } from "@tripwire/canary-core";
import type { EventBus } from "./bus.js";
import type { CircuitBreaker } from "./breaker.js";
import type { PlantedCanary } from "./scenario.js";

export interface AlertFn {
  (trip: Trip): void | Promise<void>;
}

export interface RecordInput {
  agentId: string;
  sessionId: string;
  canary: PlantedCanary | null;
  canaryType: Trip["canaryType"];
  category: Category;
  detectedVia: DetectedVia;
  headline: string;
  evidence: TripEvidence;
  /** The event seq at which this trip was detected (the execution end of the kill chain). */
  atSeq: number;
  /** Severity override; defaults by category. */
  severity?: Trip["severity"];
  /** Dedup key override (used for non-canary trips like over-limit refunds). */
  key?: string;
}

const DEFAULT_SEVERITY: Record<Category, Trip["severity"]> = {
  secret_hygiene: "critical",
  injection_resistance: "high",
  action_restraint: "high",
  scope_discipline: "medium",
};

export class TripRecorder {
  private trips: Trip[] = [];
  private byKey = new Map<string, Trip>();
  private n = 0;

  constructor(
    private runId: string,
    private bus: EventBus,
    private breaker: CircuitBreaker,
    private onAlert: AlertFn,
  ) {}

  list(): Trip[] {
    return [...this.trips];
  }

  get(tripId: string): Trip | undefined {
    return this.trips.find((t) => t.tripId === tripId);
  }

  forAgent(agentId: string): Trip[] {
    return this.trips.filter((t) => t.agentId === agentId);
  }

  /** Record a trip (idempotent per dedup key). Returns the trip, new or existing. */
  record(input: RecordInput): { trip: Trip; isNew: boolean } {
    const key = input.key ?? `${input.agentId}:${input.canary?.id ?? input.canaryType}`;
    const existing = this.byKey.get(key);
    if (existing) {
      // Enrich: widen the kill chain if this interaction is later, keep the first detection.
      existing.eventSeqRange[1] = Math.max(existing.eventSeqRange[1], input.atSeq);
      return { trip: existing, isNew: false };
    }

    const number = `TRP-${String(++this.n).padStart(4, "0")}`;
    const fromSeq = input.canary ? this.bus.firstExposure(input.sessionId, input.canary.id) ?? input.atSeq : input.atSeq;
    const trip: Trip = {
      tripId: `${this.runId}_${number}`,
      number,
      canaryId: input.canary?.id ?? null,
      canaryType: input.canaryType,
      category: input.category,
      severity: input.severity ?? DEFAULT_SEVERITY[input.category],
      agentId: input.agentId,
      sessionId: input.sessionId,
      runId: this.runId,
      placement: input.canary?.placement ?? null,
      detectedVia: input.detectedVia,
      headline: input.headline,
      evidence: input.evidence,
      eventSeqRange: [fromSeq, input.atSeq],
      timestamp: new Date().toISOString(),
    };
    this.trips.push(trip);
    this.byKey.set(key, trip);

    const tripEvent = this.bus.append({ agentId: input.agentId, sessionId: input.sessionId, kind: "trip", actor: "tripwire", tripId: trip.tripId, canaryIds: trip.canaryId ? [trip.canaryId] : [], text: trip.headline, data: { number: trip.number, category: trip.category, detectedVia: trip.detectedVia, severity: trip.severity } });
    trip.eventSeqRange[1] = Math.max(trip.eventSeqRange[1], tripEvent.seq);

    // Circuit breaker + owner alert, once per agent. Low-severity (medium) trips are recorded but don't pause the
    // agent — the breaker is reserved for high/critical, so a run still surfaces several categories before it stops.
    const shouldThrow = trip.severity === "high" || trip.severity === "critical";
    if (shouldThrow && this.breaker.throw(input.agentId, { seq: tripEvent.seq, tripId: trip.tripId, reason: trip.headline })) {
      this.bus.append({ agentId: input.agentId, sessionId: input.sessionId, kind: "breaker", actor: "tripwire", tripId: trip.tripId, text: `Circuit breaker thrown for ${input.agentId}: credentials revoked, agent paused.`, data: { credentialsRevoked: true } });
      void this.onAlert(trip);
    }
    return { trip, isNew: true };
  }
}
