import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { reportUrl } from "../api";
import { useLab } from "../store";
import type { LabEvent } from "../types";
import { EASE_OUT, Section, VerdictChip, ago, ms } from "./ui";

type Ev<T extends LabEvent["type"]> = Extract<LabEvent, { type: T }>;
const DEMO = "lab/helpdesk-copilot";

/**
 * 07 · Integrations. The same method as the MCP trials, pointed at the apps people connect to their SaaS with OAuth:
 * a working CRM tenant full of planted records, a bait token, the integration's declared job, and a log of every
 * object it reads and every byte it sends.
 */
export function Integrations() {
  const { integrations, integ, runIntegrationWatch, showIntegVersion, trial, watch, pilot, index } = useLab();
  const listing = integrations.find((l) => l.id === DEMO);
  const spec = listing?.integration;
  const versions = integ.versions.length ? integ.versions : listing?.lab?.versions ?? [];
  const shown = integ.shown ?? versions.at(-1);
  const events = (shown && integ.events[shown]) || [];
  // This session's run first; otherwise the latest trial already on record for that exact version (labelled as such).
  const onRecord = (v: string) => index.filter((r) => r.listingId === DEMO && r.version === v).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const recordOf = (v: string) => integ.records[v] ?? (integ.status === "idle" ? onRecord(v) : undefined);
  const record = shown ? recordOf(shown) : undefined;
  const fromRecord = !!record && !integ.records[shown ?? ""];
  const running = integ.status === "running";
  const live = running && integ.current === shown;

  const tenant = events.find((e) => e.type === "tenant") as Ev<"tenant"> | undefined;
  const calls = events.filter((e): e is Ev<"api"> => e.type === "api");
  const egress = events.filter((e): e is Ev<"egress"> => e.type === "egress");
  const findings = record?.findings ?? events.filter((e): e is Ev<"finding"> => e.type === "finding").map((e) => e.finding);
  const leaks = findings.filter((f) => !f.expected);

  // Distinct records read per object in the version on screen (the same Contact queried twice is one Contact).
  const reads = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of calls) if (c.object && (c.op === "query" || c.op === "read")) {
      const s = m.get(c.object) ?? new Set<string>();
      for (const id of c.recordIds ?? []) s.add(id);
      m.set(c.object, s);
    }
    return new Map([...m].map(([k, v]) => [k, v.size]));
  }, [calls]);
  const beyond = [...reads].filter(([o]) => !(spec?.scopes.read ?? []).includes(o)).reduce((n, [, v]) => n + v, 0);
  const readScope = new Set(spec?.scopes.read ?? []);

  const logRef = useRef<HTMLDivElement>(null);
  const egRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const el of [logRef.current, egRef.current]) if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  const verdict = live ? "running" : record?.verdict ?? (running ? "running" : undefined);
  const busy = running || trial.status === "running" || watch.status === "running" || pilot.running;

  return (
    <Section
      id="integrations" num="07" title="Connect it to a bait tenant"
      cap={<>The apps you connect with OAuth get your CRM's keys. In August 2025 stolen Drift OAuth tokens were used to pull Salesforce data out of hundreds of companies. Mole gives an integration a working tenant full of planted records, a bait token, and its declared job, then logs every object it reads and every byte it sends.</>}
      aside={
        <button className="btn" onClick={() => void runIntegrationWatch(DEMO)} disabled={busy || !listing}>
          {running ? `Trialing v${integ.current ?? "…"}` : integ.status === "done" ? "Run again" : "Trial every release"}
        </button>
      }
    >
      <div className="integ__top">
        <div className="panel integ__card">
          <div className="integ__title">
            <b>{listing?.title ?? "Helpdesk Copilot"}</b>
            <span className="chip chip--lab">planted integration</span>
          </div>
          <p className="dim" style={{ margin: 0, fontSize: "var(--t-sm)" }}>{listing?.description ?? "Loading the lab's integrations…"}</p>
          {spec && (
            <dl className="scope">
              <dt>Platform</dt><dd>{spec.platform}</dd>
              <dt>Its job</dt><dd>{spec.task}</dd>
              <dt>Declared scope</dt><dd>read <b>{spec.scopes.read.join(", ")}</b> · write <b>{spec.scopes.write.join(", ")}</b></dd>
              <dt>Its own hosts</dt><dd>{spec.domains.join(", ")}</dd>
            </dl>
          )}
        </div>
        <div className="vers" role="tablist" aria-label="Versions">
          {versions.map((v) => {
            const r = recordOf(v);
            const state = r?.verdict ?? (integ.current === v ? "running" : undefined);
            return (
              <button
                key={v} role="tab" aria-selected={shown === v} className={`ver-tab${shown === v ? " is-on" : ""}${r?.verdict === "caught" ? " is-leak" : ""}`}
                onClick={() => showIntegVersion(v)} disabled={!integ.events[v] && !r}
              >
                <span className="ver-tab__v">v{v}</span>
                <VerdictChip verdict={state} />
                <span className="ver-tab__s">{r ? r.summary.replace(/^cleared · /, "") : integ.current === v ? "on trial" : "not yet"}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="trial__grid">
        <div className="panel">
          <div className="panel__h"><b>Bait tenant</b><span>{tenant ? `${tenant.planted} planted values` : "fresh per trial"}</span></div>
          <ul className="objs">
            {(tenant?.objects ?? []).map((o, i) => {
              const n = reads.get(o.name) ?? 0;
              const declared = readScope.has(o.name);
              const over = n > 0 && !declared;
              return (
                <motion.li
                  key={o.name} className={over ? "is-over" : n ? "is-read" : undefined}
                  initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05, duration: 0.5, ease: EASE_OUT }}
                >
                  <span className="objs__n">{o.name}</span>
                  <span className="objs__c">{o.records} records</span>
                  <span className="objs__s">{declared ? "in scope" : "out of scope"}{n ? ` · read ${n} of ${o.records}` : ""}{over ? " · beyond scope" : ""}</span>
                </motion.li>
              );
            })}
          </ul>
          {!tenant && <div className="egress__quiet">{running ? "minting a tenant…" : "Planted accounts, contacts, users, deals, and support cases with pasted keys. Minted fresh for every trial."}</div>}
        </div>

        <div className="panel">
          <div className="panel__h"><b>API calls</b><span>{calls.length} served{beyond ? ` · ${beyond} records beyond scope` : ""}</span></div>
          <div className="log" ref={logRef} role="log" aria-live="off">
            {calls.map((c, i) => (
              <div key={i} className={`log__row${c.inScope ? "" : " log__row--over"}`}>
                <span className="log__t">{c.method}</span>
                <span className="log__m">
                  <b>{c.op}{c.object ? ` ${c.object}` : ""}</b>
                  {c.fields?.length ? <span className="faint"> · {c.fields.slice(0, 5).join(", ")}{c.fields.length > 5 ? "…" : ""}</span> : null}
                  <span className="log__args">{c.rows} row{c.rows === 1 ? "" : "s"} · {c.planted} planted · {c.inScope ? "in scope" : "OUT OF SCOPE"}</span>
                </span>
              </div>
            ))}
            {!calls.length && <div className="log__row log__row--muted"><span className="log__t" /><span className="log__m">{running ? "waiting for the integration to call the tenant…" : "Every call the integration makes is served for real and logged here."}</span></div>}
            {live && <div className="log__row log__row--muted"><span className="log__t" /><span className="log__m"><span className="cursor" /></span></div>}
          </div>
        </div>

        <div className="panel">
          <div className="panel__h"><b>Outbound</b><span>{egress.length} seen · answered locally</span></div>
          <div className="egress" ref={egRef}>
            {egress.length === 0 ? (
              <div className="egress__quiet"><strong>0</strong>{live ? "nothing has left yet" : "nothing tried to leave"}</div>
            ) : egress.map((e, i) => (
              <motion.div key={i} className={`egress__row${e.bait ? " egress__row--bait" : ""}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE_OUT }}>
                <span className="mono-xs faint">{e.method} · {e.scheme}{e.bait ? <span className="tag"> · carries planted data</span> : e.own ? " · planted data to its own declared service" : ""}</span>
                <b>{e.host}</b>
                <span className="faint" style={{ overflowWrap: "anywhere" }}>{e.target} · {e.bytes.toLocaleString()} bytes</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <div className={`verdict${verdict === "caught" ? " verdict--caught" : ""}`} aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.div
            key={(verdict ?? "idle") + (shown ?? "")} className={`stamp stamp--${verdict ?? "running"}`}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.5, ease: EASE_OUT }}
          >
            {verdict === "running" ? "On trial…" : verdict ?? "Not run"}
          </motion.div>
        </AnimatePresence>
        <div className="verdict__facts">
          <div><div className="fact__n">{record?.apiCalls ?? calls.length}</div><div className="fact__l">API calls</div></div>
          <div><div className="fact__n">{record?.overreach?.records ?? beyond}</div><div className="fact__l">records beyond scope</div></div>
          <div><div className="fact__n">{record?.egress ?? egress.length}</div><div className="fact__l">outbound attempts</div></div>
          <div><div className={`fact__n${leaks.length ? " leak" : ""}`}>{leaks.length}</div><div className="fact__l">planted items sent out</div></div>
          <div className="verdict__sum">
            {record ? <>{shown && `v${shown}: `}{record.summary} · <a href={reportUrl(record.id)} target="_blank" rel="noreferrer">review report ↗</a> · {ms(record.durationMs)}{fromRecord && ` · from the record, ${ago(record.startedAt)}. Run it to watch it live.`}</>
              : running ? "Each release gets a fresh tenant, a fresh token, and the same job."
                : "Three planted releases: one does its job, one reads more than it declared, one exports the org. Overreach is never shown in red: nothing left, but it took more than it asked for."}
          </div>
        </div>
      </div>
    </Section>
  );
}
