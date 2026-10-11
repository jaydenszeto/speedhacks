import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "./types";

/** Subscribe to the run's SSE stream. Reconnects on a new run; replays from the last seq we saw. */
export function useEventStream(active: boolean): { events: AgentEvent[]; reset: () => void } {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const lastSeq = useRef(0);

  const reset = () => { lastSeq.current = 0; setEvents([]); };

  useEffect(() => {
    if (!active) return;
    let es: EventSource | null = null;
    let stopped = false;
    const connect = () => {
      es = new EventSource(`/api/runs/current/events?since=${lastSeq.current}`);
      es.onmessage = (m) => {
        try {
          const ev = JSON.parse(m.data) as AgentEvent;
          lastSeq.current = Math.max(lastSeq.current, ev.seq);
          setEvents((prev) => (prev.some((p) => p.seq === ev.seq) ? prev : [...prev, ev]));
        } catch { /* ignore keepalives */ }
      };
      es.onerror = () => { es?.close(); if (!stopped) setTimeout(connect, 800); };
    };
    connect();
    return () => { stopped = true; es?.close(); };
  }, [active]);

  return { events, reset };
}
