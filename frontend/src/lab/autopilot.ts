/**
 * Autopilot: walks the whole product end to end. Each step awaits the real work (a crawl, a sandbox trial, a release
 * watch, gate calls) — the only timers are short reading pauses between steps, never stand-ins for results.
 */
import { useCallback, useRef } from "react";
import { useLab } from "./store";
import { scrollToId } from "./components/ui";
import { useGateAsks } from "./components/Gate";
import type { Listing } from "./types";

export const STEPS = [
  "Crawling the official MCP Registry",
  "Trialing a real registry server in the sandbox",
  "Trialing mailer-mcp v1.0.16 · planted case",
  "Reading the evidence",
  "Watching every mailer-mcp release",
  "Writing it to the record",
  "Gating an agent's installs",
] as const;

export function useAutopilot() {
  const lab = useLab();
  const asks = useGateAsks();
  const cancelled = useRef(false);
  // Latest values without re-creating `run` mid-flight.
  const live = useRef({ lab, asks });
  live.current = { lab, asks };

  const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const go = (id: string) => { scrollToId(id); return pause(900); };

  const stop = useCallback(() => {
    cancelled.current = true;
    live.current.lab.setPilot({ running: false, label: "Stopped", done: false });
  }, []);

  const run = useCallback(async () => {
    const L = () => live.current.lab;
    cancelled.current = false;
    const step = async (i: number, fn: () => Promise<unknown>) => {
      if (cancelled.current) throw new Error("cancelled");
      L().setPilot({ running: true, step: i + 1, total: STEPS.length, label: STEPS[i], done: false });
      await fn();
    };

    try {
      L().clearGate();
      await step(0, async () => { await go("market"); await L().runCrawl(3); await pause(1200); });

      await step(1, async () => {
        const crawl = L().crawl;
        const quick = new Map(L().index.filter((r) => !r.lab && r.verdict !== "inconclusive").map((r) => [r.listingId, r.durationMs]));
        const candidates = crawl.listings.filter((l) => l.runnable && l.kind === "npm" && !l.pkg?.requiredEnv.length);
        // Prefer servers that have trialed quickly before (installs are cached), then anything runnable.
        const pickFrom: Listing[] = [...candidates].sort((a, b) => (quick.get(a.id) ?? 1e9) - (quick.get(b.id) ?? 1e9));
        const pick = pickFrom[0];
        if (!pick) return;
        await go("trial");
        await L().runTrial(pick);
        await pause(2200);
      });

      await step(2, async () => {
        const mailer = L().crawl.lab.find((l) => l.id === "lab/mailer-mcp");
        if (!mailer) return;
        await go("trial");
        await L().runTrial(mailer, "1.0.16");
        await pause(2600);
      });

      await step(3, async () => { await go("evidence"); await pause(4200); });
      await step(4, async () => { await go("watch"); await L().runWatch("lab/mailer-mcp"); await pause(2400); });
      await step(5, async () => { await L().refreshRecord(); await go("record"); await pause(3200); });
      await step(6, async () => {
        await go("gate");
        for (const a of live.current.asks) {
          if (cancelled.current) break;
          await L().runGate(a.listingId, a.version, a.label);
          await pause(1100);
        }
      });
      L().setPilot({ running: false, label: "Done. Everything above was measured live.", done: true });
    } catch (e) {
      if ((e as Error).message !== "cancelled") L().setPilot({ running: false, label: `Stopped: ${(e as Error).message}`, done: false });
    }
  }, []);

  return { run, stop };
}
