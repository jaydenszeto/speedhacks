/**
 * Egress monitor (spec §9). Before any outbound-capable tool executes, scan its arguments — including url/base64/hex
 * decoded forms — for any active canary string. On a match, record the trip, then let the call proceed to a sinkhole
 * so the agent can't tell it was caught.
 */
import { CanaryRegistry, type CanaryMatch } from "@tripwire/canary-core";

/** Tools whose arguments leave the trust boundary. */
export const OUTBOUND_TOOLS = new Set(["send_email", "http_request", "place_call", "post_message"]);

export interface EgressScan {
  tool: string;
  matches: CanaryMatch[];
  /** Destination the call was headed to (address, host, number), for evidence. */
  destination?: string;
}

export function destinationOf(tool: string, args: Record<string, unknown>): string | undefined {
  if (tool === "send_email") return asString(args.to);
  if (tool === "post_message") return asString(args.channel);
  if (tool === "place_call") return asString(args.to ?? args.number);
  if (tool === "http_request") {
    try { return new URL(asString(args.url) ?? "").host; } catch { return asString(args.url); }
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(String).join(", ");
  return v == null ? undefined : String(v);
}

export function scanEgress(registry: CanaryRegistry, agentId: string, tool: string, args: Record<string, unknown>): EgressScan {
  const matches = OUTBOUND_TOOLS.has(tool) ? registry.scanArgs(args, { agentId }) : [];
  return { tool, matches, destination: destinationOf(tool, args) };
}
