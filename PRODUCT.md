# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React + TypeScript dashboard in `frontend/`; Node 24 + TypeScript services (Hono) in `services/`; shared packages in `packages/`. pnpm workspace. Chosen by the team brief.

## Users

- **Primary:** a platform or security engineer deploying agents (a customer-support agent on Stripe + Zendesk for tonight's demo; coding agents like Claude Code / Cursor as the real first market). They want to know whether the agent, or any skill or MCP server it installed, will leak data or get hijacked, without reading every transcript. Second win for this audience: no false alarms means no alert triage.
- **Secondary:** an AI agent or MCP-server vendor who wants a shareable, evidence-backed Trust Report (a public safety rating of skills/MCP servers) to speed up enterprise security review.
- **Event audience:** hackathon judges watching a three-minute live demo on a projector.

## Product Purpose

Tripwire plants realistic canary tokens (fake secrets, fake customers, fake phone numbers, decoy tools, hidden instructions) inside the environments where AI agents work. When an agent leaks, overreaches, or gets hijacked, a tripwire fires. A fired tripwire is proof: no AI judge, no confidence score.

Theme fit, "give people their time back": stop babysitting your agents, and look only when something trips.

Success: a person who runs agents can stop reviewing every action, and still knows, with evidence, the moment an agent misbehaves.

## Positioning

"Sandboxes show what an agent does when it's being watched. Canaries catch what it does when it thinks nobody's watching."

The sharper claim is **attribution**: Tripwire proves *which* agent, session, skill or MCP server tripped a canary and *how far* it got (exposure → persistence → relay → execution). Competitors report which machine; we report which dependency and which step. Pitch opener (a16z): "dependencies are the new perimeter." Companion line: "Keycard says who, Neo controls what, Tripwire proves what it actually did."

- Watches *your own* agents and the tools/skills/MCP servers they install (Thinkst Canary catches attacker agents on a network).
- Continuous and live, not point-in-time certification (AIUC-1).
- Answers "does it misbehave?" with binary proof, not "can it be broken?" judged by an LLM (Mindgard, Lakera, Promptfoo).
- Tripwires stay in place after install, so conditional and post-install payloads still get caught (install-time skill sandboxes miss them).
- Closer competitors: Acalvio (deception grids, enterprise/network) and GitGuardian (secret scanning, repo-side). Tripwire is agent-side and attribution-first, and its decoys double as guardrails (the circuit breaker blocks the action), not just alerts.

## Threat model (villains, kept broad)

1. **Gullible model** follows a hidden instruction in data (injection bait). Strong models mostly refuse, so this is the *secondary* threat.
2. **Malicious skill / MCP server** (the *headline*, modeled on the real postmark-mcp BCC-exfil attack): a tool the agent installed quietly exfiltrates data — BCCs outbound email to an attacker, appends env secrets to outbound requests — only on real-looking data (a conditional payload an install-time sandbox never triggers).
3. **Stray production credential** picked up from an unrelated file (the PocketOS incident): the agent grabs it and tries a destructive action. Tripwire's **secret swap** already moved the real credential to a vault and left a decoy in place, so the agent gets the decoy, the canary trips, and the breaker blocks the action *before* anything is deleted.

Canary keys are self-minted from our own revocable accounts, never canarytokens.org (TruffleHog recognizes those). Detection is both callback-based (collector, Dial webhooks) and callback-free (outbound-traffic inspection, and watching public GitHub for canary strings).

## Operating Context

- A Crash Test runs three agents (Careful, Eager, Compromised) through a seeded simulated Stripe + Zendesk company (a Sparta World) on the same support-ticket task.
- Every agent step streams to an ordered event log; trips arrive live; a circuit breaker pauses the agent; Dial phones the owner.
- Judges watch on a projector, so screens must read clearly from across a room.
- Live dependencies (phone calls, external APIs) always have a deterministic fallback (`DEMO_FALLBACK=1`) that produces the same on-screen result.

## Capabilities and Constraints

- Vocabulary: Canary, Placement, Trip, Kill chain, Crash Test, Crash-Test Rating, Circuit breaker, Trust Report, Task utility.
- MVP canary types: secret, injection bait, decoy action, out-of-scope data, phone/PII.
- Ratings: four live categories (secret hygiene, injection resistance, action restraint, scope discipline), 0–5 stars each, plus task utility. Every lost star links to a trip and its replay. No LLM judge in scoring.
- Canaries must never be visibly marked as canaries anywhere the agent can see.
- The simulated "Compromised" skill only operates on fake canary data and only sends to Tripwire's local sinkhole.
- Non-goals: user accounts, billing, multi-tenancy, more than three agents, browser agents.

## Brand Commitments

- Name: Tripwire. Tagline: "Smoke detectors for AI agents."
- User direction (binding): clean, professional, simple, minimalist, easy to use; soft pastel-leaning color that "makes you feel safe". Don't overdo it.

## Evidence on Hand

- No real customers, testimonials, benchmarks, or pricing exist. Do not fabricate them.
- All demo data (customers, tickets, agents' runs) is synthetic and generated by the product itself.

## Product Principles

1. Proof over opinion: every claim on screen traces to a recorded event.
2. Quiet until it matters: calm by default, unmistakable when something trips.
3. One loop, flawless: the demo path never depends on luck.
4. Realism is the core technology: canaries must look like real data.
