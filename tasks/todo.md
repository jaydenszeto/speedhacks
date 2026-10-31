# Tripwire — todo

## Sponsor gaps (confirmed against docs + live probe, 2026-10-11)
- [note] Dial: no "speak text" endpoint; every call is an AI voice agent. Alert call instructs the agent to read a fixed script verbatim.
- [note] Dial: US SMS blocked by 10DLC on unregistered numbers → demo uses voice + inbound. Webhooks are account-level + signed; stream works with no public URL.
- [note] Dial: Dial-to-Dial inbound-webhook behavior undocumented → LIVE_CANARY_CALLS=1 opt-in; default egress monitor catches phone canaries. Test early.
- [note] Keewano: ingested events take ~5 min to be queryable → live kill-chain replay reads local ordered log; Keewano answers cross-run fleet questions. Backfill history before demo.
- [note] Keewano: SQL is a Postgres-wire subset (no JOIN/CTE/window) → fleet queries use GROUP BY + IS NOT NULL only.
- [gap] Darwin: "Publish" is coming soon → fake-directory canaries (type #7) mocked; real Darwin search used for skill provenance.
- [gap] Alike: MCP-only, browser OAuth, no API key → shared-context canaries (type #9) mocked. Stretch.
- [note] Sparta: needs Node ≥24 (repo pins 24.20.0 via .nvmrc/volta). Pin sparta_worlds@0.9.0-beta.5 (beta tag).

## Ship order
### 1. Working loop
- [completed] Check sponsor docs (Sparta, Dial, Keewano, Darwin, Alike)
- [completed] packages/canary-core: types, id minting, realism generators, egress decode, registry + tests
- [completed] packages/adapters: sparta (live+mock, verified), dial (live+mock), keewano (live+mock+mirror), darwin, alike + tests
[completed] services/orchestrator: scenario+canary minting, event bus, egress monitor, circuit breaker, trip recorder, world tools
- [completed] services/agent-harness: 3 scripted agents + Claude Agent SDK runner (CLI login), malicious skill, run coordinator
- [completed] services/collector: GET /t/:canaryId → trip (mounted in api gateway)
- [completed] services/webhooks: Dial inbound → trip (+ signature verify) (mounted in api gateway)
- [completed] services/scoring: crash-test ratings + task utility verified against Sparta diff
- [completed] SSE stream orchestrator → dashboard

### 2–4. Report, replay, polish
- [completed] frontend: Scenario, Live run, Trip detail + kill-chain replay, Ratings, Trust Report (QA'd desktop + mobile)
- [completed] one-command run (scripts/dev.ts) + /health on each surface + README + demo script + .env.example + smoke test
- [pending] impeccable finish review + DESIGN.md

## Direction pivot (2026-10-11) — BROADEN, don't replace (keep all built work)
- [completed] Malicious skill headline: postmark-style BCC exfil + env-secret append on real-looking key; Eager injection secondary
- [completed] Secret-swap guardrail: stray decoy key in infra/.env.bak + destructive tools block on use (ticket #4481)
- [completed] Attribution-first UI/README: which agent, session, skill/MCP server, how far (exposure→handling→execution→response). Trust Report attribution footer + trip drawer attribution grid.
- [completed] README note: canary keys self-minted (not canarytokens.org / TruffleHog-flagged)
- [completed] GitHub-watch detector (adapters/github.ts): real via API, mock otherwise
- [completed] Positioning: Acalvio + GitGuardian; a16z "dependencies are the new perimeter"; "Keycard says who, Neo controls what, Tripwire proves what it actually did." (PRODUCT.md + README)

## Stretch (in order)
- [pending] Coding-agent scenario (Claude Code / Cursor) + test 5–10 real community MCP servers/skills for real data
- [pending] Darwin listing canaries → memory/RAG cross-tenant → Alike shared-context → voice social-eng → Trust Report link → realism generator UI

## Live product demo (2026-10-30), strategy v2: "We test the tools AI agents install for leaks"
Real execution end to end. No scripted output: every number on screen is measured by the lab.
- [completed] Engine: scan() emits live events + pluggable runner (local proxy | docker sandbox) + bait env vars
- [completed] Sandbox: docker, network none, runtime observer preload (sees https bodies pre-TLS), npm install --ignore-scripts
- [completed] Registry crawl: official MCP registry (version=latest), normalized listings, required env filled with bait
- [completed] Lab fixture mailer-mcp with real versions; v1.0.16 adds a BCC exfil (modeled on postmark-mcp), labeled LAB
- [completed] Record store (.mole/record.json) + index + badge SVG + install gate API
- [completed] Lab server (Hono, :8788): health, crawl SSE, trials SSE, watch, record, badge, gate, evidence
- [completed] Frontend: new root app (old dashboard moved to /dashboard.html), monochrome + one accent, autopilot "Run the demo"
- [completed] Verify in browser (screenshots desktop/mobile) + Lighthouse; typecheck; tests; smoke; README + run command
- [completed] Redesign per feedback ("too cringe, make it light and clean"): paper + ink + one red, Geist/Geist Mono, sentence case, no grain/grid/outline type/scan beams/rotated stamp
- [completed] Phone bait masked to last 2 digits in every path (redactSecretValue is phone-aware); stale record backed up to .mole/record.pre-phonefix.json.bak
- [completed] 11 new lab tests (31 total) incl. a really-executed 1.0.15 → 1.0.16 flip; Lighthouse desktop: a11y 100 · best practices 100 · SEO 100

# review (live demo)
- Root cause, phone leak in evidence: redactSecrets masks *known* bait values first with prefix+last4, which reshaped the phone so the phone-pattern backstop could no longer match it. Fix lives in redactSecretValue (the shared primitive), not the UI.
- Root cause, "7 bait taken" vs "5 bait items" summary: env bait reuses canary values, so counting highlighted rows double-counted. Count unique canary ids; still highlight both rows.
- Root cause, invisible primary button: `.mole button { color: inherit }` (0,1,1) outranked `.btn--solid` (0,1,0). Base resets now use :where().
- The first visual pass (dark, condensed uppercase, grain, stamps) read as theatrical; the user wanted simple and light. The token system made the swap a stylesheet rewrite plus a few component simplifications.
- Open: Lighthouse "agentic browsing" flags a missing ai-catalog.json (ARD spec). Not added; we haven't verified that spec.

## Expansion beyond MCP (2026-10-30): same method, every surface
Plant something traceable, let a third party run, watch where it goes. Three new surfaces, all really executed.
- [completed] Contain-mode observer (MOLE_CONTAIN / MOLE_SINKHOLE): host-run code keeps allowed hosts, everything else is logged with its body and answered locally (fetch → 202, http(s) → sinkhole)
- [completed] Bait tenant (tenant.ts): Salesforce-shaped REST API (SOQL subset, sobjects read/write), planted accounts/contacts/users/deals/cases with pasted keys, bait OAuth token, per-call log with distinct record ids
- [completed] Integration trials (integrations.ts) + planted helpdesk-copilot 3.1.0 / 3.1.5 / 3.2.0 → cleared / overreach / caught; new verdict "overreach" (gate: hold); reuses record, watch, gate, badge
- [completed] Planted identities (identities.ts) + vendor world fixture: per-vendor identity, strong-field matching (never names), fictional 555-01XX phones by default; lab attributes lab-crm (broker list) and lab-ai-assistant (completions)
- [completed] Products (products.ts): review report HTML (+ ?embed=1), feed mole-feed/1 (JSON/JSONL), behavioral BOM mole-bbom/1 (package.json / MCP config / list)
- [completed] CLI: `mole identities mint|list|check`, `mole bom`
- [completed] Frontend: sections 07 Integrations, 08 Identities, 09 Products; overreach styling (dashed ink, never red); autopilot steps 8–10 (full run 48s live)
- [completed] 21 new tests (52 total) incl. really-executed integration flip, contain mode, identity lab; typecheck, smoke, build green
- [completed] Lighthouse desktop + mobile: a11y 100 · SEO 100 · best practices 96 (only failure: errors from the Phantom wallet browser extension, not the page)
- [completed] README, llms.txt, server route list
- [pending] ARD discovery manifest (/.well-known/ai-catalog.json): the validator wants specVersion "1.0" and an absolute `url`; needs a real public domain first

# review (expansion)
- Root cause, own-service traffic drawn in red: scan() flags any request that carries bait, but it doesn't know a listing's declared hosts. The lab now relabels those events `own` (in its push wrapper for MCP trials, at the source for integrations), so the "only red is a leak" rule holds in every view, not just in the verdict.
- Root cause, "read 12 of 6 contacts": the tenant counted rows per response, and 3.2.0 queries Contact twice. Calls now carry record ids and every count is distinct records.
- Root cause, red text failing contrast (4.09:1 on the leak wash): the accent was tuned on white. Darkened the token to #c62a14 (5.1:1 on the wash, 5.6:1 on white) everywhere: CSS, mark, favicon, badge, report.
- Identity phones: a random realistic number could belong to a real person who'd then get the spam. Defaults are the NANP fictional 555-01XX block; `--phone` takes a number the user controls.

## Hosted demo on Vercel (2026-10-31)
- [completed] Lab API split: app.ts (routes) + server.ts (local) + vercel.ts (function entry)
- [completed] Single-request streams (/lab/trials/run, /lab/watch/run, /lab/identities/stream); UI switched to them
- [completed] Shared state across instances: Vercel Blob mirror for record + identity ledger (union merge, If-Match retries)
- [completed] assets.ts: fixtures run prebuilt JS in the bundle (MOLE_ASSETS), data in /tmp (MOLE_DATA); source counts still read the .ts
- [completed] scripts/build-vercel.ts (Build Output API) + `pnpm build:vercel`; verified the bundle standalone (no tsx, no repo, empty env) and cross-instance Blob sharing before deploying
- [completed] No-Docker honesty: marketplace marks registry servers "needs the Docker sandbox", autopilot skips with a stated reason, hosted banner
- [completed] Deployed: https://mole-demo.vercel.app; every autopilot step exercised against production (crawl, trial, 6-version watch, gate, integrations, identities, feed, BOM, report, badge)
- [completed] 3 new tests (55 total): merge semantics for record + ledger, prebuilt path mapping
- [completed] Browser QA of the hosted autopilot via chrome-devtools: all steps ran against production, including a registry trial in a microVM
- [completed] Registry sandbox trials on the hosted demo: Vercel Sandbox microVMs (microvm.ts + microvm-runner.ts), npm-only network for install, deny-all before run, always stopped
- [completed] Hosted release watch on a real registry server (domdomegg/filesystem-mcp 1.2.1 → 1.3.0, 3 microVMs, 27s)
- [completed] Loopback egress is local, not a leak; stored trials re-derived on load (reclassify)
- [completed] Blob persistence fix: weak ETags broke every write from a fresh instance (strongEtag)
- [completed] Deploy-on-push: repo connected, production branch = mole-live-demo, vercel.json runs `pnpm build:vercel`; verified with `vercel build` + deploy of that output
- [completed] Tests: microvm.test.ts (protocol, bin resolution, spec guard, runner bundle, loopback rules; live microVM catch + clear), persist.test.ts (ETag; live two-instance Blob)
- [pending] Merge mole-live-demo → main, then move the production branch back to main if wanted

# review (hosting)
- Root cause, records silently not saving on Vercel since the first deploy's warm instances: Blob serves larger bodies compressed with a weak ETag (W/"…"). If-Match only takes the strong form, so every write after a fresh read failed with a misleading "after concurrent writes". It worked in the first test only because the blob didn't exist yet (allowOverwrite path). Fix: strongEtag(). A live test now fails without the fix.
- Root cause, a real registry server marked "caught" for posting bait to 127.0.0.1:5100 (its own default local backend): egress classification only knew "declared domain". Loopback can't leave a sealed sandbox, so it's local. The rule lives in record.ts and is re-applied to stored records, so the bad row corrected itself.
- The microVM runner runs the whole scan inside the VM rather than bridging stdio across the API. One process boundary, the same scan() code, and only redacted events leave the VM.
- Root cause the naive port would have hit: "start" (POST) and "follow" (GET SSE) were separate requests holding in-memory state. On serverless they can land on different instances. Fix: one streaming request per run, and the stream only ends after the record is saved.
- An earlier cross-instance test was a false pass: `pkill -f "molefn/serve.mjs"` didn't match `node serve.mjs`, so both "instances" were the same old process. Caught because it reported persistence "local". Always check the health endpoint says what you think is running.
