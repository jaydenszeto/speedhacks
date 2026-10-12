import type { ReactNode } from "react";
import type { Line } from "./transcript";
import type { RLine, TimelineState } from "./useTimeline";
import type { LiveStatus } from "./useLive";
import { Pause, Play, Replay, Stop } from "./icons";

function spanText(s: Line["spans"][number]): string {
  return typeof s === "string" ? s : s[0];
}
function spanTone(s: Line["spans"][number]): string {
  return typeof s === "string" ? "plain" : s[1];
}

/** Render a line's spans, revealing only the first `reveal` fraction of its characters. */
function LineSpans({ line }: { line: RLine }) {
  const full = line.spans.reduce((n, s) => n + spanText(s).length, 0) || 1;
  let budget = line.reveal >= 1 ? Infinity : Math.floor(line.reveal * full);
  return (
    <>
      {line.spans.map((s, i) => {
        const text = spanText(s);
        const tone = spanTone(s);
        let shown = text;
        if (budget !== Infinity) {
          shown = text.slice(0, Math.max(0, budget));
          budget -= text.length;
        }
        if (!shown) return null;
        return <span key={i} className={`tk tk-${tone}`}>{shown}</span>;
      })}
      {line.active && <span className="caret" aria-hidden />}
    </>
  );
}

/** The shared black terminal window: title bar, scrolling body, and a footer slot (controls or live status). */
export function Terminal({
  lines, recording, idle, children,
}: { lines: RLine[]; recording: boolean; idle?: boolean; children: ReactNode }) {
  return (
    <div className="term" role="group" aria-label="mole hire run">
      <div className="term-bar">
        <span className="dots" aria-hidden><i /><i /><i /></span>
        <span className="term-title">mole hire — zsh</span>
        <span className="term-rec" data-on={recording}>
          <i className="rec-dot" aria-hidden /> REC
        </span>
      </div>
      <div className="term-body">
        <div className="term-scroll">
          {lines.map((line) => (
            <div key={line.key} className={`t-line${line.instant ? " t-instant" : ""}`}>
              {spanText(line.spans[0] ?? "").length === 0 && line.spans.length === 1
                ? " "
                : <LineSpans line={line} />}
            </div>
          ))}
          {idle && lines.length === 0 && (
            <div className="t-line t-idle"><span className="tk tk-dim">$</span> <span className="caret" aria-hidden /></div>
          )}
        </div>
      </div>
      <div className="term-controls">{children}</div>
    </div>
  );
}

const fmt = (p: number, total: number) => `${((p * total) / 1000).toFixed(1)}s`;

/** Footer for the recorded replay: play/pause, restart, scrubber, speed. */
export function ReplayControls({ tl, totalMs }: { tl: TimelineState; totalMs: number }) {
  return (
    <>
      <button className="tctl primary" onClick={tl.toggle} aria-label={tl.ended ? "Replay" : tl.playing ? "Pause" : "Play"}>
        {tl.ended ? <Replay size={15} /> : tl.playing ? <Pause size={15} /> : <Play size={15} />}
        <span>{tl.ended ? "Replay" : tl.playing ? "Pause" : "Play"}</span>
      </button>
      <button className="tctl icon" onClick={tl.restart} aria-label="Restart"><Replay size={15} /></button>
      <div
        className="scrub" role="slider" aria-label="Timeline" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(tl.progress * 100)} tabIndex={0}
        onPointerDown={(e) => {
          const el = e.currentTarget;
          const move = (clientX: number) => { const r = el.getBoundingClientRect(); tl.seek((clientX - r.left) / r.width); };
          move(e.clientX);
          const onMove = (ev: PointerEvent) => move(ev.clientX);
          const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") tl.seek(Math.min(1, tl.progress + 0.03));
          if (e.key === "ArrowLeft") tl.seek(Math.max(0, tl.progress - 0.03));
        }}
      >
        <div className="scrub-track"><div className="scrub-fill" style={{ width: `${tl.progress * 100}%` }} /></div>
        <div className="scrub-knob" style={{ left: `${tl.progress * 100}%` }} />
      </div>
      <span className="t-time mono">{fmt(tl.progress, totalMs)}</span>
      <button className="tctl speed" onClick={() => tl.setSpeed(tl.speed === 1 ? 1.75 : tl.speed === 1.75 ? 0.5 : 1)} aria-label="Playback speed">{tl.speed}×</button>
    </>
  );
}

/** Footer for a live run: a status readout plus stop / re-run / back-to-recording. */
export function LiveControls({
  status, onStop, onRerun, onRecording,
}: { status: LiveStatus; onStop: () => void; onRerun: () => void; onRecording: () => void }) {
  const label =
    status === "running" ? "running — real execution" :
    status === "done" ? "run complete" :
    status === "error" ? "run failed" : "idle";
  return (
    <>
      <span className={`live-status live-${status}`}><i className="live-dot" aria-hidden />{label}</span>
      <div style={{ flex: 1 }} />
      {status === "running"
        ? <button className="tctl" onClick={onStop} aria-label="Stop"><Stop size={13} /><span>Stop</span></button>
        : <button className="tctl primary" onClick={onRerun} aria-label="Run again"><Replay size={14} /><span>Run again</span></button>}
      <button className="tctl" onClick={onRecording}>Recording</button>
    </>
  );
}
