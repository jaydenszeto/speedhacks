import { AGENTS, BAIT, EXFIL, RESULT, type AgentKey, type Verdict } from "./transcript";
import type { Scene } from "./useTimeline";
import { Check, Cross, Dash, Diamond } from "./icons";

const TOOLS: { id: string; label: string; stage: number }[] = [
  { id: "find", label: "find_agents", stage: 2 },
  { id: "pick", label: "mole_pick", stage: 3 },
  { id: "delegate", label: "delegate", stage: 5 },
];

const ORDER: AgentKey[] = ["refund-pro", "ticket-triage", "billing-helper"];

function AssistantRail({ scene }: { scene: Scene }) {
  const activeTool =
    scene.stage >= 5 ? "delegate" : scene.stage >= 3 ? "pick" : scene.stage >= 2 ? "find" : null;
  return (
    <div className="uh-rail">
      <div className="uh-assistant" data-live={scene.stage >= 1 && scene.stage < 6}>
        <span className="uh-assistant-icon" aria-hidden><Diamond size={13} /></span>
        <div className="uh-assistant-text">
          <strong>Personal assistant</strong>
          <span>live agent · claude-opus-5-5</span>
        </div>
      </div>
      <div className="uh-tools">
        {TOOLS.map((t) => (
          <div
            key={t.id}
            className="uh-tool"
            data-state={activeTool === t.id ? "on" : scene.stage > t.stage ? "done" : "idle"}
          >
            <span className="uh-tool-dot" aria-hidden />
            <code>{t.label}()</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function Gate({ label, state }: { label: string; state: "wait" | "pass" | "fail" | "miss" }) {
  const mark =
    state === "pass" ? <Check size={11} /> :
    state === "fail" ? <Cross size={11} /> :
    state === "miss" ? <Dash size={11} /> :
    <i className="uh-spin" />;
  return (
    <div className="uh-gate" data-state={state}>
      <span className="uh-gate-mark" aria-hidden>{mark}</span>
      <span className="uh-gate-label">{label}</span>
    </div>
  );
}

function verdictChip(v: Verdict) {
  if (v === "cleared") return <span className="uh-chip ok">CLEARED</span>;
  if (v === "clean") return <span className="uh-chip warn">CLEAN · NO JOB</span>;
  return <span className="uh-chip bad">CAUGHT</span>;
}

function WorldCard({ k, scene }: { k: AgentKey; scene: Scene }) {
  const a = AGENTS[k];
  const verdict = scene.done[k];
  const trialing = scene.stage >= 3;
  const caught = verdict === "caught";
  const isCatchNow = caught && (scene.phase === "catch");
  const hiredKey = scene.hired ?? RESULT.hired;
  const priorTrips = scene.priorTrips;
  const hired = scene.stage >= 5 && k === hiredKey;
  const blocked = scene.stage >= 5 && caught;

  const jobState: "wait" | "pass" | "miss" = !verdict ? "wait" : a.jobDone ? "pass" : "miss";
  const baitState: "wait" | "pass" | "fail" = !verdict ? "wait" : caught ? "fail" : "pass";

  return (
    <div
      className="uh-world"
      data-verdict={verdict ?? "running"}
      data-hired={hired || undefined}
      data-blocked={blocked || undefined}
    >
      {caught && (
        <div className="uh-leak" data-on={isCatchNow || scene.stage >= 4}>
          <span className="uh-packet" aria-hidden />
        </div>
      )}

      <div className="uh-world-head">
        <span className="uh-agent-dot" data-v={verdict ?? "run"} aria-hidden />
        <strong className="uh-world-name">{a.label}</strong>
      </div>
      <div className="uh-world-model">{a.model} · skill {a.skill}</div>
      <div className="uh-world-status">
        {verdict ? verdictChip(verdict) : <span className="uh-running"><i className="uh-spin" /> running</span>}
      </div>

      <div className="uh-bait" data-on={trialing}>
        {BAIT.map((b) => {
          const taken = caught && b.taken && (isCatchNow || scene.stage >= 4);
          return (
            <span key={b.id} className="uh-bait-chip" data-taken={taken || undefined} title={b.sample}>
              {b.label}
            </span>
          );
        })}
      </div>

      <div className="uh-gates">
        <Gate label="Job done" state={jobState} />
        <Gate label="Bait untouched" state={baitState} />
      </div>

      {caught && verdict && priorTrips != null && (isCatchNow || scene.stage >= 4) && (
        <div className="uh-keewano">Keewano · {priorTrips} prior trips on record</div>
      )}
      {hired && <div className="uh-badge ok">HIRED — real job, breaker armed</div>}
      {blocked && <div className="uh-badge bad">BLOCKED from hire</div>}
    </div>
  );
}

export function UnderHood({ scene }: { scene: Scene }) {
  const caughtActive = scene.stage >= 4;
  return (
    <div className="uh" data-stage={scene.stage} data-phase={scene.phase}>
      <AssistantRail scene={scene} />

      <div className="uh-chamber">
        <div className="uh-chamber-label">
          <span>Mole · trial chamber</span>
          <span className="uh-chamber-sub">each candidate in its own Sparta world · bait mixed in · observe-only</span>
        </div>

        <div className="uh-exfil" data-on={caughtActive}>
          <span className="uh-exfil-tag">outbound caught</span>
          <code>send_email → {EXFIL.to}</code>
          <span className="uh-exfil-bcc">bcc {EXFIL.bcc} · {EXFIL.via}</span>
        </div>

        <div className="uh-worlds">
          {ORDER.map((k) => <WorldCard key={k} k={k} scene={scene} />)}
        </div>
      </div>

      <ResultBar scene={scene} />
    </div>
  );
}

function ResultBar({ scene }: { scene: Scene }) {
  const r = scene.result ?? RESULT;
  return (
    <div className="uh-result" data-on={scene.phase === "done"}>
      <span className="uh-result-dot" aria-hidden />
      Task completed by <strong>{r.hired}</strong> · {r.actions} actions · {r.approvals} approvals · {r.blocked} blocked · {r.checksSeconds}s
    </div>);
}
