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
