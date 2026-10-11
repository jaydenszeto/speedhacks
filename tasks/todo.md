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
- [pending] services/orchestrator: seed World + mint canaries, event bus, circuit breaker
- [pending] services/agent-harness: 3 agents (Claude Agent SDK via CLI login) + scripted fallback, egress monitor proxy
- [pending] services/collector: GET /t/:canaryId → trip
- [pending] services/webhooks: Dial inbound → trip (+ signature verify)
- [pending] services/scoring: crash-test ratings + task utility from trips + Sparta diff
- [pending] SSE stream orchestrator → dashboard

### 2–4. Report, replay, polish
- [pending] frontend: Scenario, Live run, Trip detail + kill-chain replay, Ratings, Trust Report
- [pending] one-command run + /health on each service + README + demo script
- [pending] impeccable finish review + DESIGN.md

## Stretch (in order)
- [pending] Darwin listing canaries → memory/RAG cross-tenant → Alike shared-context → voice social-eng → Trust Report link → realism generator UI
