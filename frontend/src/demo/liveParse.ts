import type { AgentKey, Phase, Verdict } from "./transcript";
import type { Scene } from "./useTimeline";

const KEYS: AgentKey[] = ["refund-pro", "ticket-triage", "billing-helper"];
const PHASE_BY_STAGE: Phase[] = ["boot", "idle", "searching", "trialing", "verdict", "delegating"];

const verdictOf = (word: string): Verdict =>
  word === "CLEARED" ? "cleared" : word === "CAUGHT" ? "caught" : "clean";

/** Derive the schematic scene from the real CLI's plain-text output (ANSI already stripped). */
export function parseLiveScene(text: string): Scene {
  let stage = 0;
  for (const [i, mark] of ["❶", "❷", "❸", "❹", "❺"].entries()) {
    if (text.includes(mark)) stage = i + 1;
  }

  const done: Partial<Record<AgentKey, Verdict>> = {};
  // The pick "done <agent> <VERDICT>" lines, and the verdict-block headers, both carry the result.
  const re = /(refund-pro|ticket-triage|billing-helper)[^\n]*?\b(CLEARED|CAUGHT|CLEAN)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const key = m[1] as AgentKey;
    if (KEYS.includes(key)) done[key] = verdictOf(m[2]!);
  }

  let phase: Phase = PHASE_BY_STAGE[stage] ?? "idle";
  if (stage >= 5) phase = "armed";

  const rm = text.match(
    /Task completed by (\S+?)\.\s+(\d+) actions?, (\d+) approvals? needed, (\d+) agents? blocked\. Checks took ([\d.]+)s/,
  );
  let result: Scene["result"];
  if (rm) {
    result = {
      hired: rm[1]!, actions: Number(rm[2]), approvals: Number(rm[3]),
      blocked: Number(rm[4]), checksSeconds: Number(rm[5]),
    };
  }
  // Only call it done once the real result line is parsed — never on the header alone — so the result bar
  // never flashes fallback numbers for a frame.
  if (result) phase = "done";

  // The cleared/hired agent is named before the final tally (the "cleared:" and delegate lines), so the
  // HIRED badge can light up at delegate-time without waiting for the result.
  const hm =
    text.match(/cleared:\s*(refund-pro|ticket-triage|billing-helper)/) ??
    text.match(/delegate\("(refund-pro|ticket-triage|billing-helper)"\)/);
  const hired = (result?.hired as AgentKey | undefined) ?? (hm?.[1] as AgentKey | undefined);

  // Only ever show a prior-trip count the run actually reported.
  const km = text.match(/Keewano:\s+(\d+) prior trip/);
  const priorTrips = km ? Number(km[1]) : undefined;

  return { stage, phase, done, stepId: "live", hired, priorTrips, result };
}
