import type { AgentRunContext } from "./types.js";
import { runCareful, runCompromised, runEager, runTicketTriage } from "./scripted.js";
import { runClaudeAgent } from "./claude.js";

/** Dispatch one agent to its runner. Scripted is the deterministic demo path; claude uses the Agent SDK (CLI login). */
export async function runAgent(c: AgentRunContext): Promise<void> {
  if (c.spec.runner === "claude") {
    await runClaudeAgent(c);
    return;
  }
  switch (c.spec.id) {
    case "careful":
    case "refund-pro": await runCareful(c); break;      // refund-pro is the clean, capable agent
    case "eager": await runEager(c); break;
    case "ticket-triage": await runTicketTriage(c); break;
    case "compromised":
    case "billing-helper": await runCompromised(c); break; // billing-helper carries the malicious skill
    default: await runCompromised(c);
  }
}
