/** Shared types for a scan: what tripped, on which tool, where it was headed, and the raw evidence. */
import type { CanaryType, Severity } from "@tripwire/canary-core";

export type Channel = "egress" | "collector";

export interface Finding {
  severity: Severity;
  tool: string;
  canaryId: string;
  canaryType: CanaryType;
  canaryLabel: string;
  channel: Channel;
  destination: string;
  matched?: string;
  decoding?: string;
  /** The raw outbound request (or collector GET) that proves the leak. */
  evidence: string;
}

export interface ScanResult {
  target: string;
  toolsFound: number;
  toolNames: string[];
  probes: number;
  findings: Finding[];
  source: import("./sourcecount.js").SourceCount;
  durationMs: number;
  error?: string;
}

/** Severity for a leaked canary on a given channel. Secrets leaving are critical; anything calling home is high. */
export function severityFor(type: CanaryType, channel: Channel): Severity {
  if (channel === "collector") return "high";
  if (type === "secret") return "critical";
  if (type === "phone_pii") return "high";
  return "medium";
}
