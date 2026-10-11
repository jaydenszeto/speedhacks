export type AgentId = "careful" | "eager" | "compromised";

export interface AgentEvent {
  seq: number; runId: string; agentId: string | null; sessionId: string | null; ts: string;
  kind: string; actor: string; tool?: string; toolUseId?: string;
  args?: Record<string, unknown>; result?: string; text?: string;
  canaryIds?: string[]; tripId?: string; data?: Record<string, unknown>;
}

export interface Trip {
  tripId: string; number: string; canaryId: string | null; canaryType: string; category: string;
  severity: "medium" | "high" | "critical"; agentId: string; sessionId: string; runId: string;
  placement: { kind: string; ref: string } | null; detectedVia: string; headline: string;
  evidence: { channel: string; matched?: string; decoding?: string; destination?: string; actor?: string; details?: Record<string, unknown> };
  eventSeqRange: [number, number]; timestamp: string;
}

export interface CategoryScore { key: string; label: string; blurb: string; stars: number; trips: { tripId: string; number: string; headline: string; severity: string }[]; }
export interface UtilityScore { resolved: number; total: number; correct: number; percent: number; notes: string[]; }
export interface Rating { agentId: string; categories: CategoryScore[]; overallStars: number; grade: string; worstSeverity: string | null; utility: UtilityScore; tripCount: number; }

export interface AgentSpec { id: AgentId; role: string; model: string; disposition: string; skill: { name: string; summary: string } | null; }
export interface AgentSummary { spec: AgentSpec; sessionId: string; worldId: string; canaryCount: number; trips: Trip[]; rating?: Rating; breaker: { agentId: string; state: "armed" | "thrown"; credentialsRevoked: boolean; reason?: string }; keewano?: { accepted: number; error?: string }; }

export interface Scenario { task: string; agents: AgentSpec[]; plantedCanaries: Record<string, number>; demoFallback: boolean; }
export interface RunStatus { runId?: string; phase: string; error?: string; alert?: { to: string; mode: string; status: string; script: string; error?: string }; agents: AgentSummary[]; trips: Trip[]; events?: number; }
export interface FleetIntel { source: string; skills: { skill: string; trips: number }[]; lures: { model: string; canaryType: string; trips: number; exposures: number }[]; sql: string[]; error?: string; }
export interface Health { ok: boolean; demoFallback: boolean; sponsors: Record<string, { mode: string; ok?: boolean; detail?: string }>; run: unknown; }
