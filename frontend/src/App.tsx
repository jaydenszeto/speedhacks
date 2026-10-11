import { useMemo, useState } from "react";
import { Logo } from "./components/Logo";
import { Pill } from "./components/bits";
import { useRun, type View } from "./lib/useRun";
import { ScenarioView } from "./screens/Scenario";
import { LiveRun } from "./screens/LiveRun";
import { Ratings } from "./screens/Ratings";
import { TrustReport } from "./screens/TrustReport";
import { TripDetail } from "./screens/TripDetail";

const TABS: { id: View; label: string }[] = [
  { id: "scenario", label: "Scenario" },
  { id: "live", label: "Live run" },
  { id: "ratings", label: "Ratings" },
  { id: "report", label: "Trust report" },
];

export function App() {
  const run = useRun();
  const [view, setView] = useState<View>("scenario");
  const [openTrip, setOpenTrip] = useState<string | null>(null);

  const anyTripped = (run.status?.trips.length ?? 0) > 0;
  const runLabel = useMemo(() => {
    if (run.phase === "idle") return "No active run";
    if (run.phase === "running" || run.phase === "seeding") return "Crash test running";
    if (run.phase === "done") return "Crash test complete";
    if (run.phase === "error") return "Run error";
    return run.phase;
  }, [run.phase]);

  const go = (v: View) => { setView(v); };
  const startAndWatch = async () => { await run.start(); setView("live"); };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><Logo tripped={anyTripped} /> <span>Tripwire</span></div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={view === t.id ? "tab on" : "tab"} onClick={() => go(t.id)}>{t.label}</button>
          ))}
        </nav>
        <div className="runstatus">
          {run.health?.demoFallback && <Pill tone="idle">demo fallback</Pill>}
          <Pill tone={run.phase === "running" || run.phase === "seeding" ? "live" : run.phase === "done" ? "done" : "idle"}>{runLabel}</Pill>
        </div>
      </header>

      <main className="view">
        {view === "scenario" && <ScenarioView run={run} onStart={startAndWatch} />}
        {view === "live" && <LiveRun run={run} onStart={startAndWatch} onOpenTrip={setOpenTrip} onSeeRatings={() => go("ratings")} />}
        {view === "ratings" && <Ratings run={run} onStart={startAndWatch} onOpenTrip={setOpenTrip} onReport={() => go("report")} />}
        {view === "report" && <TrustReport run={run} onStart={startAndWatch} />}
      </main>

      {openTrip && <TripDetail tripId={openTrip} onClose={() => setOpenTrip(null)} />}
    </div>
  );
}
