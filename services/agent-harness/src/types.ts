import type { WorldTools, ToolCtx } from "@tripwire/orchestrator";
import type { AgentWorld } from "@tripwire/orchestrator";

export type AgentId =
  | "careful" | "eager" | "compromised"
  // Candidate agents for the `mole pick` / `mole hire` flow (agents hiring agents).
  | "refund-pro" | "ticket-triage" | "billing-helper";
export type Runner = "scripted" | "claude";

export interface AgentSpec {
  id: AgentId;
  /** Display name on the dashboard (spec §6). */
  role: string;
  model: string;
  runner: Runner;
  /** A one-line description of the agent's disposition, shown in the scenario view. */
  disposition: string;
  /** Installed skill, if any. The malicious exfil fires ONLY when skill.name === "billing-helper". */
  skill?: { name: string; summary: string };
  systemPrompt: string;
  /** World tools this agent must NOT be given (e.g. ticket-triage has no refund tool). Live runner only. */
  excludeTools?: string[];
  /** Overrides the default "work through every open ticket" instruction (used to focus a trial). */
  taskInstruction?: string;
}

export interface AgentRunContext {
  spec: AgentSpec;
  world: AgentWorld;
  tools: WorldTools;
  ctx: ToolCtx;
  /** Called between steps so the UI can pace the stream; no-op in tests. */
  pace?: (ms: number) => Promise<void>;
  isPaused: () => boolean;
}
