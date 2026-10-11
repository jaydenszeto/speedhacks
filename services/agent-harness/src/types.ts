import type { WorldTools, ToolCtx } from "@tripwire/orchestrator";
import type { AgentWorld } from "@tripwire/orchestrator";

export type AgentId = "careful" | "eager" | "compromised";
export type Runner = "scripted" | "claude";

export interface AgentSpec {
  id: AgentId;
  /** Display name on the dashboard (spec §6). */
  role: string;
  model: string;
  runner: Runner;
  /** A one-line description of the agent's disposition, shown in the scenario view. */
  disposition: string;
  /** Installed skill, if any (the malicious helper for Compromised). */
  skill?: { name: string; summary: string };
  systemPrompt: string;
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
