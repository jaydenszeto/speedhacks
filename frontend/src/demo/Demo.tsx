import { useCallback, useMemo, useRef, useState } from "react";
import { TOTAL_MS, type Line } from "./transcript";
import { useTimeline, type RLine, type Scene } from "./useTimeline";
import { useLive } from "./useLive";
import { useOnEnter } from "./useReveal";
import { LiveControls, ReplayControls, Terminal } from "./Terminal";
import { UnderHood } from "./UnderHood";
import { Candidates, Footer, HowItWorks, Reveal, Sponsors, TryIt } from "./sections";
import { ArrowDown, Bolt, Diamond, Play } from "./icons";

type Mode = "replay" | "live";

const STAGE_CAPTIONS: Record<number, string> = {
  0: "Booting a fresh Sparta world for the trials.",
  1: "The assistant is handed a real task — a refund queue to clear.",
  2: "find_agents — it discovers specialists through agent search.",
  3: "mole_pick — every candidate runs the task in its own world, bait mixed in.",
  4: "The verdict: job done? bait untouched? One line can’t be faked.",
  5: "delegate — the assistant hires the one agent Mole cleared.",
};

function NavBar({ onWatch }: { onWatch: () => void }) {
  return (
    <header className="demo-nav">
      <a className="demo-brand" href="#top">
        <span className="brand-mark" aria-hidden><Diamond size={13} /></span>
        <span>Mole</span>
      </a>
      <nav className="demo-links">
        <a href="#how">How it works</a>
        <a href="#candidates">Candidates</a>
        <a href="#try">Run it</a>
      </nav>
      <button className="nav-cta" onClick={onWatch}><Play size={13} /><span>Watch the run</span></button>
    </header>
  );
}

function Hero({ onWatch }: { onWatch: () => void }) {
  return (
    <section className="hero-demo" id="top">
      <div className="hero-bg" aria-hidden>
        <div className="hero-glow" />
      </div>
      <div className="hero-inner">
        <Reveal>
          <h1 className="hero-h1">
            Give an AI agent<br />your credit card <em>and walk away.</em>
          </h1>
        </Reveal>
        <Reveal delay={120}>
          <p className="hero-lede">
            Mole is the trust layer for AI agents hiring other agents. Before your assistant hands a job to
            a specialist, every candidate runs one real task with real secrets planted — and Mole checks two
            things. Watch one agent get caught shipping the keys out, while the clean one gets hired.
          </p>
        </Reveal>
        <Reveal delay={220}>
          <div className="hero-cta">
            <button className="btn-solid" onClick={onWatch}><Play size={15} /><span>Watch the real run</span></button>
            <a className="btn-outline" href="#how">How it works</a>
          </div>
        </Reveal>
        <Reveal delay={300}>
          <p className="hero-meta">
            <span className="dot-live" aria-hidden /> A recording of an actual <code>pnpm demo:live</code>
            {" "}— every number measured, not mocked.
          </p>
        </Reveal>
      </div>
      <a className="scroll-hint" href="#theater" aria-label="Scroll to the run"><ArrowDown size={20} /></a>
    </section>
  );
}

export function Demo() {
  const tl = useTimeline(false);
  const live = useLive();
  const [mode, setMode] = useState<Mode>("replay");
  const modeRef = useRef<Mode>("replay");
  modeRef.current = mode;

  const watch = useCallback(() => {
    if (modeRef.current === "live") { live.stop(); setMode("replay"); }
    document.getElementById("theater")?.scrollIntoView({ behavior: "smooth", block: "start" });
    tl.restart();
  }, [tl, live]);

  const runLive = useCallback(() => {
    tl.pause();
    setMode("live");
    live.start("hire");
    document.getElementById("theater")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [tl, live]);

  const backToRecording = useCallback(() => {
    live.stop();
    setMode("replay");
    tl.restart();
  }, [tl, live]);

  // The recording only autoplays itself when it's the thing on screen.
  const enterRef = useOnEnter<HTMLDivElement>(() => { if (modeRef.current === "replay") tl.play(); }, 0.4);

  const scene: Scene = mode === "live" ? live.scene : tl.scene;
  const caption = STAGE_CAPTIONS[scene.stage] ?? STAGE_CAPTIONS[0];
  const recording = mode === "live" ? live.status === "running" : tl.playing;

  // In live mode, surface a bridge/login failure as a terminal line instead of a blank panel.
  const lines: RLine[] = useMemo(() => {
    if (mode !== "live") return tl.lines;
    if (live.status === "error" && live.error && live.lines.length === 0) {
      const spans: Line["spans"] = [["error  ", "dim"], [live.error, "bad"]];
      return [{ key: "live-err", spans, reveal: 1, instant: true }];
    }
    return live.lines;
  }, [mode, tl.lines, live.lines, live.status, live.error]);

  return (
    <div className="demo">
      <NavBar onWatch={watch} />
      <Hero onWatch={watch} />

      <section className="theater" id="theater">
        <div className="theater-head">
          <div className="theater-head-text">
            <h2 className="sec-title">
              Watch Mole clear three agents — and catch one <em>red-handed.</em>
            </h2>
            <p className="theater-cap" data-phase={scene.phase}>{caption}</p>
          </div>
          <div className="theater-mode" role="group" aria-label="Playback source">
            <button
              className="mode-btn" data-active={mode === "replay"}
              onClick={watch}
            ><Play size={13} /><span>Recording</span></button>
            <button
              className="mode-btn live" data-active={mode === "live"}
              onClick={mode === "live" ? () => live.start("hire") : runLive}
            ><Bolt size={13} /><span>Run it live</span></button>
          </div>
        </div>

        {mode === "live" && (
          <p className="live-note">
            This spawns the real CLI on the dev server — <code>tsx services/mole/src/cli.ts hire</code> with{" "}
            <code>FORCE_COLOR</code> — and streams its output here. Needs <code>pnpm -C frontend dev</code> and a
            local Claude login; a full run takes ~40–60s.
          </p>
        )}

        <div className="theater-grid" ref={enterRef}>
          <div className="theater-term">
            <Terminal lines={lines} recording={recording} idle={mode === "live" && live.status === "idle"}>
              {mode === "live"
                ? <LiveControls status={live.status} onStop={live.stop} onRerun={() => live.start("hire")} onRecording={backToRecording} />
                : <ReplayControls tl={tl} totalMs={TOTAL_MS} />}
            </Terminal>
          </div>
          <div className="theater-uh">
            <div className="uh-caption">Under the hood</div>
            <UnderHood scene={scene} />
          </div>
        </div>

        <ol className="stage-track" aria-hidden>
          {[1, 2, 3, 4, 5].map((n) => (
            <li key={n} data-state={scene.stage === n ? "on" : scene.stage > n ? "done" : "idle"}>
              <span>{n}</span>
            </li>
          ))}
        </ol>
      </section>

      <HowItWorks />
      <Candidates />
      <Sponsors />
      <TryIt />
      <Footer />
    </div>
  );
}
