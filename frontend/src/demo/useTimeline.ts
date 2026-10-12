import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RESULT, STEPS, TOTAL_MS, type AgentKey, type Line, type Phase, type Verdict } from "./transcript";

export interface RLine {
  key: string;
  spans: Line["spans"];
  /** 0..1 type-on fraction for this line; 1 = fully shown. */
  reveal: number;
  instant?: boolean;
  active?: boolean;
}

export interface LiveResult {
  hired: string; actions: number; approvals: number; blocked: number; checksSeconds: number;
}

export interface Scene {
  stage: number;
  phase: Phase;
  done: Partial<Record<AgentKey, Verdict>>;
  stepId: string;
  /** The cleared-and-hired agent, once known (recording: the measured pick; live: parsed from the run). */
  hired?: AgentKey;
  /** Keewano prior-trip count — only set when actually measured, so live never shows a fabricated number. */
  priorTrips?: number;
  /** Final tally. Recording leaves this undefined (ResultBar falls back to the measured RESULT constant). */
  result?: LiveResult;
}

export interface TimelineState {
  lines: RLine[];
  scene: Scene;
  progress: number;
  playing: boolean;
  ended: boolean;
  speed: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  restart: () => void;
  seek: (fraction: number) => void;
  setSpeed: (s: number) => void;
}

// Precompute each step's absolute start time on the timeline.
const STARTS: number[] = (() => {
  const out: number[] = [];
  let acc = 0;
  for (const s of STEPS) { out.push(acc); acc += s.dur; }
  return out;
})();

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Derive everything shown at time `elapsed` (ms). Pure, so seeking is just setting elapsed. */
function derive(elapsed: number): { lines: RLine[]; scene: Scene } {
  const t = Math.min(elapsed, TOTAL_MS);
  const lines: RLine[] = [];
  const done: Partial<Record<AgentKey, Verdict>> = {};
  let stage = 0;
  let phase: Phase = "boot";
  let stepId = STEPS[0]!.id;

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i]!;
    const start = STARTS[i]!;
    const end = start + step.dur;
    const started = t >= start;
    const completed = t >= end;
    if (!started) break;

    stepId = step.id;
    if (step.stage != null) stage = step.stage;
    phase = step.phase ?? phase;
    if (step.done) done[step.done[0]] = step.done[1];

    const ls = step.lines ?? [];
    if (completed) {
      ls.forEach((l, j) => lines.push({ key: `${step.id}:${j}`, spans: l.spans, reveal: 1, instant: l.instant }));
      continue;
    }
    // Active step: reveal its lines across its local window.
    const local = clamp01((t - start) / step.dur);
    const n = ls.length || 1;
    ls.forEach((l, j) => {
      const lineProg = clamp01((local - j / n) / (1 / n));
      if (lineProg <= 0) return;
      lines.push({
        key: `${step.id}:${j}`,
        spans: l.spans,
        reveal: l.instant ? 1 : lineProg,
        instant: l.instant,
        active: lineProg < 1,
      });
    });
  }

  // Mark the final visible line active while mid-stream, for cursor placement.
  if (t < TOTAL_MS && lines.length) {
    const last = lines[lines.length - 1]!;
    if (last.reveal >= 1) last.active = true;
  }

  // The recording is the measured 45-trip run that hired refund-pro; carry those so the schematic matches the terminal.
  return { lines, scene: { stage, phase, done, stepId, hired: RESULT.hired as AgentKey, priorTrips: RESULT.priorTrips } };
}

export function useTimeline(autoStart = false): TimelineState {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(autoStart);
  const [speed, setSpeed] = useState(1);
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    if (!playing) {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      last.current = null;
      return;
    }
    const tick = (now: number) => {
      if (last.current == null) last.current = now;
      const dt = (now - last.current) * speedRef.current;
      last.current = now;
      setElapsed((e) => {
        const next = e + dt;
        if (next >= TOTAL_MS) { setPlaying(false); return TOTAL_MS; }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current != null) cancelAnimationFrame(raf.current); };
  }, [playing]);

  const { lines, scene } = useMemo(() => derive(elapsed), [elapsed]);

  const play = useCallback(() => {
    setElapsed((e) => (e >= TOTAL_MS ? 0 : e));
    setPlaying(true);
  }, []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying((p) => !p), []);
  const restart = useCallback(() => { last.current = null; setElapsed(0); setPlaying(true); }, []);
  const seek = useCallback((fraction: number) => {
    last.current = null;
    setElapsed(clamp01(fraction) * TOTAL_MS);
  }, []);

  return {
    lines, scene,
    progress: elapsed / TOTAL_MS,
    playing,
    ended: elapsed >= TOTAL_MS,
    speed,
    play, pause, toggle, restart, seek, setSpeed,
  };
}
