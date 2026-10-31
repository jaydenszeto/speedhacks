import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { checkIdentities } from "../api";
import { useLab } from "../store";
import type { Sighting } from "../types";
import { EASE_OUT, Section } from "./ui";

/**
 * 08 · Identities. Every vendor gets its own minted person. If any of that person turns up somewhere (a broker list,
 * a spam email, an AI model's output), the ledger names the one vendor it was given to.
 */
export function Identities() {
  const { ids, runIdentities, pilot } = useLab();
  const running = ids.status === "running";
  const [text, setText] = useState("");
  const [check, setCheck] = useState<{ busy: boolean; sightings?: Sighting[]; error?: string }>({ busy: false });

  const doCheck = async () => {
    setCheck({ busy: true });
    try { setCheck({ busy: false, sightings: (await checkIdentities(text)).sightings }); }
    catch (e) { setCheck({ busy: false, error: (e as Error).message }); }
  };

  return (
    <Section
      id="identities" num="08" title="Give every vendor its own person"
      cap="Sign up for each vendor, processor, or AI assistant with an identity minted for it alone: name, email, phone, unit number, and a one-off phrase. Nobody else ever sees it. When any of it surfaces on a broker list, in a breach dump, or in a model's output, you know exactly who leaked or sold it."
      aside={<button className="btn" onClick={() => void runIdentities()} disabled={running || pilot.running}>{running ? "Running…" : ids.status === "done" ? "Run again" : "Run the identity lab"}</button>}
    >
      <div className="ids">
        <div className="panel">
          <div className="panel__h"><b>Vendors</b><span>planted · fixtures/vendors</span></div>
          {ids.vendors.length === 0 ? (
            <div className="empty">Three planted vendors: a newsletter that keeps your signup, a CRM that quietly sells it, and an AI assistant that trains on your chats.</div>
          ) : (
            <ul className="vend">
              {ids.vendors.map((v, i) => {
                const m = ids.minted[v.id];
                const seen = ids.sightings.filter((s) => s.vendor === v.id);
                const quiet = ids.quiet?.includes(v.id);
                return (
                  <motion.li key={v.id} className={seen.length ? "is-leak" : undefined} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08, duration: 0.5, ease: EASE_OUT }}>
                    <div className="vend__head">
                      <b>{v.id}</b>
                      <span className="faint">{v.does} · via {v.channel}</span>
                      <span className={`vend__res${seen.length ? " leak" : ""}`}>
                        {seen.length ? "sighted" : quiet ? "quiet" : ids.handoffs[v.id] ? "handed over" : m ? "minted" : "…"}
                      </span>
                    </div>
                    {m && (
                      <div className="vend__id mono-xs">
                        <span>{m.name}</span><span>{m.email}</span><span>{m.phone}</span><span>{m.address}</span><span>{m.phrase}</span>
                      </div>
                    )}
                    {seen.map((s, k) => (
                      <div key={k} className="vend__seen">
                        Identity {s.identityId} found in <b>{s.source}</b> · matched {s.fields.join(", ")}. It was only ever given to {s.vendor}.
                      </div>
                    ))}
                  </motion.li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="ids__side">
          <div className="panel">
            <div className="panel__h"><b>Sweeps</b><span>where leaked data surfaces</span></div>
            <div className="sweeps">
              <AnimatePresence initial={false}>
                {ids.sweeps.map((s, i) => (
                  <motion.div key={i} className="sweep" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE_OUT }}>
                    <b>{s.source}</b><span className="faint">{s.detail} · {s.bytes.toLocaleString()} bytes</span>
                  </motion.div>
                ))}
              </AnimatePresence>
              {!ids.sweeps.length && <div className="faint" style={{ padding: "8px 0" }}>{running ? "handing identities to vendors…" : "A data broker's public list, and the AI assistant probed with the start of what we told it."}</div>}
              {ids.error && <div className="faint">error: {ids.error}</div>}
              {ids.status === "done" && (
                <div className="ids__sum">
                  <span className={ids.sightings.length ? "leak" : undefined}>{new Set(ids.sightings.map((s) => s.vendor)).size} of {ids.vendors.length} vendors leaked</span>
                  {ids.quiet?.length ? <span className="faint"> · quiet: {ids.quiet.join(", ")}</span> : null}
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel__h"><b>Check any text</b><span>a spam email, a breach dump, a model reply</span></div>
            <div className="checker">
              <label className="sr" htmlFor="id-check">Text to check against the identity ledger</label>
              <textarea id="id-check" value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Paste anything. Mole looks for every identity on the ledger: email, phone, unit number, phrase. Names alone never count." />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="btn btn--sm" onClick={() => void doCheck()} disabled={!text.trim() || check.busy}>{check.busy ? "Checking…" : "Check against the ledger"}</button>
                <span className="mono-xs faint">POST /lab/identities/check</span>
              </div>
              {check.sightings && (check.sightings.length
                ? check.sightings.map((s, i) => <div key={i} className="vend__seen">Identity {s.identityId} · given only to <b>{s.vendor}</b> · matched {s.fields.join(", ")}</div>)
                : <div className="mono-xs dim">No identity on the ledger appears in that text.</div>)}
              {check.error && <div className="mono-xs dim">error: {check.error}</div>}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
