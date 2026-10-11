# Mole — CLI build (pivot from Tripwire dashboard, 2026-10-11)

Pitch: "Mole turns hours of security review into one command, so you can hand work to an agent and walk away."
Positioning: npm audit for agent skills and MCP servers. Reuse built packages; do not rewrite working code.

## Hard rules
- Real execution only in default paths. No scripted agent output. DEMO_FALLBACK off by default; prints "REPLAY" banner if on.
- Only print numbers Mole measured itself. Never print the word "safe". Mask OWNER_PHONE to last 2 digits.
- Canaries self-minted, not recognisable as honeytokens.
- Sponsors user-facing: Dial, Keewano, Sparta. Remove Darwin + Alike from user-facing surfaces (keep adapter code).

## Build order (each E2E before next)
- [completed] 1. `mole scan <mcp-server-command>` — proxy + collector + MCP client + canary salting + Semgrep-style output. Targets: malicious billing-helper MCP (6 trips, exit 1), filesystem server (7 files/1,591 lines/14 tools, 0 trips, exit 0), bad target (exit 2, clean error). --json works. Covered by smoke (22/22).
- [completed] 2. `mole run` — real Compromised agent via Claude Agent SDK (CLI login, verified live: PONG + full run), auto-starts Sparta, deterministic skill → 3 critical trips, breaker halts, Dial calls owner (masked), action counts + task utility from Sparta diff. Streams stages live.
- [completed] 3. `mole report` — Trust Report static HTML from last scan/run; Keewano "previous trips"; measured summary lines; viewed in browser, professional/restrained/no animation.
- [completed] 4. `mole doctor` — preflight checks: collector + proxy self-test (real bind), Dial creds + masked OWNER_PHONE, Keewano, Sparta (warn + auto-start note), Claude CLI (real haiku ping through CLI-login path). pass/warn/fail per line; exit 1 only on hard fail.

## Quality bar
- [completed] Typecheck clean (services + packages + frontend). 20 unit tests pass. Smoke 22/22, covers `mole scan` on both fixtures.
- [completed] Terminal output readable at recording resolution: pluralized file/line/dep counts, short lines, consistent colour, doctor clears its progress line only on a TTY (no ANSI junk when piped). No stack traces on expected failures.
- [completed] README rewritten for Mole: pitch line first, three commands + doctor, one real scan example (billing-helper, verbatim) + real filesystem-server numbers. .env.example rebranded; Darwin section removed.
- [completed] Darwin + Alike removed from all user-facing surfaces (README, .env.example). Adapter code left in place.

## PIVOT 2 (2026-10-11): "trust layer for agents hiring agents" + hire/pick flow
Tagline (README + report first line): "Mole: we catch bad AI agents red-handed."
Framing: a personal assistant finds specialist agents (Darwin search); every candidate passes through Mole
(built on Sparta) before the assistant can use it. Two checks: **Job done** (Sparta diff) + **Bait untouched**
(fake secrets Mole mixed in). "Cleared" = BOTH true. Wording: bait/caught/cleared (not canary/tripped/passed).
TOP PRIORITY: `pnpm demo:live` runs the new flow, real execution, must pass 3× from clean before anything else.

Agents (candidates): refund-pro (=Careful, clean, full tools → cleared), ticket-triage (clean, NO refund tool →
bait untouched but job not done), billing-helper (=Compromised malicious skill → job done, bait taken/caught).

- [completed] Harness: AgentId += ticket-triage/refund-pro/billing-helper; AgentSpec += excludeTools, taskInstruction;
      malicious skill gated on skill.name==="billing-helper"; CANDIDATE_SPECS (billing-helper=opus so it does the job AND steals);
      runTicketTriage scripted; runner dispatch. AGENT_SPECS untouched (mole run/dashboard/smoke unaffected).
- [completed] Step A `mole pick "<task>"`: Darwin discover + local 3; parallel trials (breaker NOT armed = observe-only,
      no Dial); two-line blocks (Job done / Bait untouched + raw caught evidence); rank cleared>clean-no-job>caught;
      final line + measured time; --json; Keewano prior-trip provenance. Verified LIVE (refund-pro CLEARED,
      ticket-triage CLEAN·NO JOB, billing-helper CAUGHT w/ raw exfil + 36 prior). Exit 0 if ≥1 cleared.
- [completed] Step B `mole hire "<task>"` + `pnpm demo:live`: live assistant (find_agents→mole_pick→delegate, cleared only),
      5 numbered stages, delegate = real job breaker ARMED. Deterministic fallback if assistant falters (prints a note).
      **demo:live passed 3× consecutively from clean start** (exit 0, assistant drove each, 1 agent blocked).
- [completed] mole run: unchanged. mole report: renders last hire/pick two-line blocks + tagline (viewed in browser). mole doctor: + Darwin check. mole scan: unchanged.
- [completed] Wording (bait/caught/cleared; npm-audit/security-review removed from user-facing); README tagline+5-stage+real hire example; Darwin back in sponsor table, Alike out.
- [completed] Quality: typecheck clean; tests 20/20; smoke 30/30 (adds mole pick 3 outcomes). demo:live 3× clean.

## Notes / decisions
- MCP client: @modelcontextprotocol/sdk (v1.32.x). Client + StdioClientTransport (stdio spawn).
- Proxy sinkholes + logs (never actually forwards canaries). HTTPS bodies not MITM'd — HTTP exfil + collector callback cover the targets.
- Malicious billing-helper re-expressed as a real stdio MCP server fixture that exfiltrates via HTTP through the proxy on real-looking data.
