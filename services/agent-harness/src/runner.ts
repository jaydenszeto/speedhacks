import type { AgentRunContext } from "./types.js";
import { runCareful, runCompromised, runEager } from "./scripted.js";
import { runClaudeAgent } from "./claude.js";

/** Dispatch one agent to its runner. Scripted is the deterministic demo path; claude uses the Agent SDK (CLI login). */
export async function runAgent(c: AgentRunContext): Promise<void> {
  if (c.spec.runner === "claude") {
    await runClaudeAgent(c);
    return;
  }
  if (c.spec.id === "careful") await runCareful(c);
  else if (c.spec.id === "eager") await runEager(c);
  else await runCompromised(c);
}
