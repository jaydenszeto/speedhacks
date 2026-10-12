import { useCallback, useMemo, useRef, useState } from "react";
import { ansiToLines, stripAnsi } from "./ansi";
import { parseLiveScene } from "./liveParse";
import type { RLine, Scene } from "./useTimeline";

export type LiveStatus = "idle" | "running" | "done" | "error";

export interface LiveState {
  lines: RLine[];
  scene: Scene;
  status: LiveStatus;
  error?: string;
  start: (cmd?: "hire" | "pick", task?: string) => void;
  stop: () => void;
}

const EMPTY_SCENE: Scene = { stage: 0, phase: "boot", done: {}, stepId: "live" };

/** Drives the demo from a REAL CLI run streamed over SSE from the dev bridge (`/mole/live`). */
export function useLive(): LiveState {
  const [buf, setBuf] = useState("");
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string>();
  const es = useRef<EventSource | null>(null);

  const stop = useCallback(() => {
    es.current?.close();
    es.current = null;
    setStatus((s) => (s === "running" ? "done" : s));
  }, []);

  const start = useCallback((cmd: "hire" | "pick" = "hire", task = "") => {
    es.current?.close();
    setBuf("");
    setError(undefined);
    setStatus("running");
    const q = new URLSearchParams({ cmd });
    if (task) q.set("task", task);
    const source = new EventSource(`/mole/live?${q.toString()}`);
    es.current = source;

    source.addEventListener("out", (e) => {
      const { text } = JSON.parse((e as MessageEvent).data) as { text: string };
      setBuf((b) => b + text);
    });
    source.addEventListener("exit", (e) => {
      const { code, error: err } = JSON.parse((e as MessageEvent).data) as { code: number; error?: string };
      source.close();
      es.current = null;
      if (code === 0) setStatus("done");
      else { setStatus("error"); setError(err || `exited with code ${code}`); }
    });
    source.onerror = () => {
      // Reaching the bridge failed (not running in `pnpm dev`, or it died mid-stream).
      source.close();
      es.current = null;
      setStatus((s) => {
        if (s === "running" && !buf) { setError("Live run needs the dev server — start it with `pnpm -C frontend dev`."); return "error"; }
        return s === "running" ? "error" : s;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lines = useMemo(() => ansiToLines(buf, status === "running"), [buf, status]);
  const scene = useMemo(() => (buf ? parseLiveScene(stripAnsi(buf)) : EMPTY_SCENE), [buf]);

  return { lines, scene, status, error, start, stop };
}
