---
version: 1
slug: "frontend-src-app-tsx"
primary_target: "frontend/src/App.tsx"
related_targets: []
---

# Surface: Tripwire dashboard (frontend/)

Scope: the whole Tripwire web app: Scenario setup, Live run, Trip detail + kill-chain replay, Crash-Test Ratings, Trust Report. Visitor mode: **Operate**. The Trust Report route is a shareable read-only page and still uses the same system.

Audience and job: a platform/security engineer runs a Crash Test of three agents and reads trips only when they fire; hackathon judges watch on a projector. Task: start a run, watch lanes, open a trip, read its proof, compare ratings, share a report.

Constraints: projector legibility (body ≥ 15px, data ≥ 13px mono), deterministic demo states, no canary ever marked as a canary in agent-visible content (dashboard may label them), no fabricated claims.

## Direction contract

THESIS: Claim beside proof. Every assertion on screen (a trip, a lost star, a "clean" verdict) sits next to the recorded event that proves it. It refuses the category default of KPI tiles over a colorful chart wall.

OWN-WORLD: A warm-neutral stone scale (#FAFAF9 ground, #FFFFFF surfaces, #E7E5E4 hairlines, #18181B ink) with one sage accent (#4F8A6E) used only for the primary action and live state, and one muted brick (#B5483A) used only for trips. Geist for the UI at two weights, Geist Mono for events and evidence. 12px radii, 1px hairline borders, no shadows except one soft lift on the open proof panel. Raises kept: kill chain as one line with ordered stations at right angles; state also carried by line form (solid = live, dashed = paused, struck through = revoked); stable short IDs (TRP-0001, CNY-…); a tight type scale where rank comes from weight first.

STORY: The visitor sees calm (three agents running, nothing to read), then a single trip arrives with its proof already attached, opens the replay to see exposure → execution, and leaves with ratings where every lost star links to evidence.

FIRST VIEWPORT: A 64px top bar (wordmark left, five text tabs, run status right). Below it, the page title with a one-line run summary. Left column (fluid): the agents table (agent, model, last step, state pill) with streaming step rows under each agent. Right column (420px): the proof panel, quiet ("No trips. Nothing to review.") until a trip fills it with headline, placement, ordered evidence rows, and the primary sage "Open replay" button. The primary action for the run ("Start crash test" / "Stop") sits top right of the title row.

FORM: Claim + Proof Monochrome (catalog challenger digital-design-canon-monochrome-product-marketing), chosen over grounded candidate 3 "Ward Call Light"; seed key f842496f. Signature interaction: when a trip lands, the agent row's state pill turns brick and gets struck through, its line goes from solid to dashed, and the proof panel slides in the evidence rows one by one (staggered 60ms), each row linking to its event.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
