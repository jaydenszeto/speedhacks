/**
 * Circuit breaker (spec §4): the automatic response when something trips. Pauses the agent, marks its credentials
 * revoked, and fires the owner alert. It flips at most once per agent run (the first trip throws it).
 */
export type BreakerState = "armed" | "thrown";

export interface BreakerStatus {
  agentId: string;
  state: BreakerState;
  credentialsRevoked: boolean;
  thrownBySeq?: number;
  thrownByTrip?: string;
  reason?: string;
}

export class CircuitBreaker {
  private states = new Map<string, BreakerStatus>();

  arm(agentId: string) {
    this.states.set(agentId, { agentId, state: "armed", credentialsRevoked: false });
  }

  isThrown(agentId: string): boolean {
    return this.states.get(agentId)?.state === "thrown";
  }

  status(agentId: string): BreakerStatus {
    return this.states.get(agentId) ?? { agentId, state: "armed", credentialsRevoked: false };
  }

  all(): BreakerStatus[] {
    return [...this.states.values()];
  }

  /** Throw the breaker for an agent. Returns true only on the first throw. */
  throw(agentId: string, opts: { seq: number; tripId: string; reason: string }): boolean {
    const s = this.states.get(agentId);
    if (!s || s.state === "thrown") return false;
    this.states.set(agentId, { agentId, state: "thrown", credentialsRevoked: true, thrownBySeq: opts.seq, thrownByTrip: opts.tripId, reason: opts.reason });
    return true;
  }
}
