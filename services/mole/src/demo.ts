/**
 * DEMO_FALLBACK is off by default. If it is ever enabled, Mole prints a loud REPLAY banner so no one mistakes
 * mocked output for a live result. The default demo paths run for real.
 */
import { col } from "./format.js";

export function isReplay(): boolean {
  return ["1", "true", "yes"].includes((process.env.DEMO_FALLBACK ?? "").toLowerCase());
}

export function replayBannerIfEnabled(): void {
  if (!isReplay()) return;
  const bar = "━".repeat(58);
  console.log(col.yellow(bar));
  console.log(col.yellow(col.bold("  REPLAY — DEMO_FALLBACK is on. Output is mocked, not a live run.")));
  console.log(col.yellow(bar));
}
