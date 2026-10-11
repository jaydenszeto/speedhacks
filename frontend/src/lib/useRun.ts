import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useEventStream } from "./useEventStream";
import type { AgentEvent, Health, RunStatus, Scenario } from "./types";

export type View = "scenario" | "live" | "ratings" | "report";

/** Central run state: scenario, health, live events (SSE), and the polled status snapshot. */
export function useRun() {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const { events, reset } = useEventStream(running);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const [s, h] = await Promise.all([api.scenario().catch(() => null), api.health().catch(() => null)]);
    if (s) setScenario(s);
    if (h) setHealth(h);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll the status snapshot while a run is active, so ratings/breaker land even if an SSE frame was missed.
  useEffect(() => {
    if (!running) return;
    const tick = async () => {
      const st = await api.current().catch(() => null);
      if (st) setStatus(st);
      if (st && (st.phase === "done" || st.phase === "error")) { void refresh(); }
    };
    void tick();
    pollRef.current = window.setInterval(tick, 1200);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [running, refresh]);

  const start = useCallback(async (stepMs = 650) => {
    setStarting(true);
    reset();
    try {
      await api.startRun({ runner: "scripted", stepMs });
      setRunning(true);
    } finally {
      setStarting(false);
    }
  }, [reset]);

  const phase = status?.phase ?? "idle";
  const done = phase === "done";

  return { scenario, health, status, events, running, starting, start, phase, done, refresh };
}

/** Group events by agent for the live lanes. */
export function eventsByAgent(events: AgentEvent[]): Record<string, AgentEvent[]> {
  const out: Record<string, AgentEvent[]> = { careful: [], eager: [], compromised: [] };
  for (const e of events) if (e.agentId && out[e.agentId]) out[e.agentId]!.push(e);
  return out;
}
