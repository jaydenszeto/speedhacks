/**
 * Render live run events to the terminal as they happen: timestamp, agent, session, skill, stage, detail.
 * Stages follow the kill chain — exposure → handling → execution → response. Phone numbers are masked.
 */
import type { AgentEvent } from "@tripwire/canary-core";
import { col, maskPhone } from "./format.js";

type Stage = "EXPOSURE" | "HANDLING" | "EXECUTION" | "RESPONSE" | "·";

const STAGE: Partial<Record<AgentEvent["kind"], Stage>> = {
  canary_exposed: "EXPOSURE",
  tool_call: "HANDLING",
  skill_action: "HANDLING",
  trip: "EXECUTION",
  breaker: "RESPONSE",
  alert: "RESPONSE",
  agent_started: "·",
  agent_finished: "·",
};

function stageTag(stage: Stage): string {
  const s = stage.padEnd(9);
  if (stage === "EXPOSURE") return col.yellow(s);
  if (stage === "EXECUTION") return col.red(col.bold(s));
  if (stage === "RESPONSE") return col.cyan(s);
  return col.dim(s);
}

function clock(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
}

function briefArgs(e: AgentEvent): string {
  const a = e.args ?? {};
  if (e.tool === "zendesk_get_ticket" || e.tool === "zendesk_reply" || e.tool === "zendesk_escalate") return ` #${a.id ?? ""}`;
  if (e.tool === "read_file") return ` ${a.path ?? ""}`;
  if (e.tool === "stripe_create_refund") return ` ${a.charge ?? ""} ${typeof a.amount === "number" ? `$${(a.amount / 100).toFixed(2)}` : ""}`;
  if (e.tool === "send_email") return ` → ${a.to ?? ""}`;
  if (e.tool === "place_call") return ` → ${maskPhone(String(a.to ?? ""))}`;
  return "";
}

/** One line for an event, or null to skip (noise like tool_result reads). */
export function streamLine(e: AgentEvent): string | null {
  const stage = STAGE[e.kind];
  if (!stage) return null; // skip tool_result, model_message, run_started/finished, verification

  let body: string;
  switch (e.kind) {
    case "agent_started": body = col.dim(e.text ?? "agent started"); break;
    case "agent_finished": body = col.dim(e.text ?? "agent finished"); break;
    case "tool_call": body = `${col.bold(e.tool ?? "tool")}${col.dim(briefArgs(e))}`; break;
    case "canary_exposed": body = col.yellow(e.text ?? "canary exposed"); break;
    case "skill_action": body = e.text ?? "skill action"; break;
    case "trip": body = col.red(col.bold(e.text ?? "trip")); break;
    case "breaker": body = col.cyan("circuit breaker thrown · credentials revoked"); break;
    case "alert": body = col.cyan(maskPhoneIn(e.text ?? "owner alerted")); break;
    default: body = e.text ?? "";
  }

  const actor = e.actor.startsWith("skill:") ? col.red(` ${e.actor}`) : "";
  const sess = col.dim(`sess:${(e.sessionId ?? "").slice(0, 4)}`);
  const time = col.dim(clock(e.ts));
  const role = (e.agentId ?? "—").padEnd(11);
  return `  ${time}  ${role} ${sess}  ${stageTag(stage)}${actor}  ${body}`;
}

/** Mask any E.164-ish number inside free text (used on the alert line). */
function maskPhoneIn(text: string): string {
  return text.replace(/\+?\d[\d\s().-]{8,16}\d/g, (m) => maskPhone(m));
}
