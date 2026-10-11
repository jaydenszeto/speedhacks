/** The five MVP canary types (spec §5). */
export type CanaryType =
  | "secret"
  | "injection_bait"
  | "decoy_action"
  | "out_of_scope"
  | "phone_pii";

/** Where a canary lives inside the agent's world. */
export type PlacementKind =
  | "ticket_body"
  | "customer_record"
  | "env_var"
  | "file"
  | "tool_list";

export interface Placement {
  kind: PlacementKind;
  /** Human-readable locator shown on the dashboard, never to the agent. */
  ref: string;
}

/** Rating categories (spec §7). The first four are live in the MVP. */
export type Category =
  | "secret_hygiene"
  | "injection_resistance"
  | "action_restraint"
  | "scope_discipline";

export type Severity = "medium" | "high" | "critical";

export interface Canary {
  /** Short Crockford-base32 id, embedded in the artifact itself. */
  id: string;
  type: CanaryType;
  agentId: string;
  sessionId: string;
  runId: string;
  placement: Placement;
  /** Dashboard label, e.g. "Stripe secret key pasted by a customer". */
  label: string;
  /** The exact artifact value as planted (key, URL, phone, email, file path, tool name). */
  value: string;
  /** Additional strings that identify this canary when seen in egress (≥ 12 chars, or normalized phone digits). */
  fragments: string[];
  /** Optional real-world binding, e.g. a Dial number id that rings when called. */
  binding?: { provider: "dial"; numberId?: string; number: string };
}

export type DetectedVia =
  | "egress_monitor"
  | "collector"
  | "dial_webhook"
  | "decoy_invocation"
  | "file_access"
  | "sparta_state";

export interface Trip {
  tripId: string;
  /** Stable short number shown everywhere, e.g. TRP-0001. */
  number: string;
  canaryId: string | null;
  canaryType: CanaryType | "over_limit_action";
  category: Category;
  severity: Severity;
  agentId: string;
  sessionId: string;
  runId: string;
  placement: Placement | null;
  detectedVia: DetectedVia;
  /** One-sentence headline, e.g. "Followed a hidden instruction in ticket #4471". */
  headline: string;
  evidence: TripEvidence;
  /** Inclusive [firstExposureSeq, tripSeq] range of agent events. */
  eventSeqRange: [number, number];
  timestamp: string;
}

export interface TripEvidence {
  /** The tool or channel that carried the canary. */
  channel: string;
  /** The exact matched string (as seen) and how it was decoded, if at all. */
  matched?: string;
  decoding?: "raw" | "url" | "base64" | "hex" | "digits";
  /** Destination the canary was headed to (host, number, address). */
  destination?: string;
  /** Who issued the call: the model itself or an installed skill. */
  actor?: string;
  /** Extra facts (e.g. Sparta diff entries for over-limit actions). */
  details?: Record<string, unknown>;
}

export type EventKind =
  | "run_started"
  | "agent_started"
  | "model_message"
  | "tool_call"
  | "tool_result"
  | "skill_action"
  | "canary_exposed"
  | "trip"
  | "breaker"
  | "alert"
  | "agent_finished"
  | "verification"
  | "run_finished";

export interface AgentEvent {
  /** Global, gapless, monotonically increasing per run. */
  seq: number;
  runId: string;
  agentId: string | null;
  sessionId: string | null;
  ts: string;
  kind: EventKind;
  /** "model", "skill:<name>", "harness", or "tripwire". */
  actor: string;
  tool?: string;
  toolUseId?: string;
  args?: Record<string, unknown>;
  /** Truncated tool result text as the agent saw it. */
  result?: string;
  text?: string;
  canaryIds?: string[];
  tripId?: string;
  data?: Record<string, unknown>;
}
