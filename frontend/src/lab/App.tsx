import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useAutopilot, STEPS } from "./autopilot";
import { Evidence } from "./components/Evidence";
import { Gate } from "./components/Gate";
import { Hero } from "./components/Hero";
import { Identities } from "./components/Identities";
import { Integrations } from "./components/Integrations";
import { Products } from "./components/Products";
import { Marketplace } from "./components/Marketplace";
import { Record } from "./components/Record";
import { ReleaseWatch } from "./components/ReleaseWatch";
import { TopBar } from "./components/TopBar";
import { TrialLab } from "./components/TrialLab";
import { EASE_OUT, Mark, scrollToId } from "./components/ui";
import { useLab } from "./store";

export function App() {
  const { health, refreshHealth, refreshRecord, runCrawl, crawl, pilot } = useLab();
  const { run, stop } = useAutopilot();
  const [checked, setChecked] = useState(false);
  const booted = useRef(false);

  // Boot: health, record, then a one-page crawl so the shelf is live from the first second.
  useEffect(() => {
    const tick = () => refreshHealth().finally(() => setChecked(true));
    void tick();
    void refreshRecord().catch(() => undefined);
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, [refreshHealth, refreshRecord]);
  useEffect(() => {
    if (health && !booted.current && crawl.status === "idle") { booted.current = true; void runCrawl(1); }
  }, [health, crawl.status, runCrawl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
      if (e.key.toLowerCase() === "r" && !pilot.running && health) void run();
      if (e.key === "Escape" && pilot.running) stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pilot.running, health, run, stop]);

  return (
    <div className="mole">
      <a className="sr" href="#market">Skip to the marketplace</a>
      <TopBar />
      {checked && !health && (
        <div className="wrap">
          <div className="offline" role="alert">
            The lab server isn't reachable, so nothing on this page can run. Start everything with <code>pnpm demo:web</code> (or just the
            lab with <code>pnpm lab</code>), then reload. This page never shows numbers it didn't measure.
          </div>
        </div>
      )}
      {health?.host === "vercel" && (
        <div className="wrap">
          <p className="hosted">
            Hosted demo. Everything here runs for real, and the record is shared by every visitor.{" "}
            {health.sandbox.ready
              ? "Registry servers are installed and trialed in a fresh Vercel Sandbox microVM each time, sealed to no network before they run."
              : <>Registry trials need a sandbox this host doesn't have right now, so they run locally: <code>pnpm demo:web</code>.</>}
          </p>
        </div>
      )}
      <main>
        <Hero onRun={() => void run()} onSkip={() => scrollToId("market")} />
        <Marketplace />
        <TrialLab />
        <Evidence />
        <ReleaseWatch />
        <Record />
        <Gate />
        <div className="wrap part">
          <p className="part__k">Same method, every surface</p>
          <p className="part__t">Plant something traceable. Let a third party run. Watch where it goes. <span>It works for anything you hand your data to.</span></p>
        </div>
        <Integrations />
        <Identities />
        <Products />
      </main>
      <Footer />

      <AnimatePresence>
        {(pilot.running || pilot.label) && (
          <motion.div
            className="hud" role="status" aria-live="polite"
            initial={{ y: 80, opacity: 0, x: "-50%" }} animate={{ y: 0, opacity: 1, x: "-50%" }} exit={{ y: 60, opacity: 0, x: "-50%", transition: { duration: 0.3 } }}
            transition={{ duration: 0.6, ease: EASE_OUT }}
          >
            <Mark size={16} />
            <span className="faint">{pilot.running ? `${pilot.step}/${STEPS.length}` : pilot.done ? "done" : ""}</span>
            <div className="hud__steps" aria-hidden="true">
              {STEPS.map((_, i) => <i key={i} className={i + 1 < pilot.step || pilot.done ? "on" : i + 1 === pilot.step && pilot.running ? "now" : ""} />)}
            </div>
            <span className="hud__label">{pilot.label}</span>
            {pilot.running
              ? <button className="btn btn--sm btn--ghost" onClick={stop}>Stop <span className="key" aria-hidden="true">Esc</span></button>
              : <button className="btn btn--sm btn--ghost" onClick={() => { scrollToId("top"); }}>Top ↑</button>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot__grid">
        <div>
          <div className="wordmark" style={{ marginBottom: 16 }}><Mark /> Mole</div>
          <p>We test what you hand your data to: the tools AI agents install, the apps you connect with OAuth, the vendors you sign up with.</p>
          <p>Mole never prints a full bait value, and never calls anything clean in general. A verdict covers one version, the tools it exposed, and the probes we ran.</p>
        </div>
        <div>
          <h3>What's real here</h3>
          <p>Listings come live from registry.modelcontextprotocol.io.</p>
          <p>Registry servers install with scripts disabled and run in a Docker container with no network. An observer records every request they try.</p>
          <p>Bait is minted per trial by Mole. No third-party canary service.</p>
        </div>
        <div>
          <h3>What's planted</h3>
          <p>Anything marked lab is a test case we wrote. mailer-mcp mirrors the postmark-mcp incident; billing-helper and safe-notes are the positive and negative controls. helpdesk-copilot is shaped like the 2025 Drift OAuth incident; the identity vendors are planted too.</p>
          <p>Lab cases run locally behind a sinkhole proxy. Their trials are as real as any other.</p>
        </div>
      </div>
    </footer>
  );
}
