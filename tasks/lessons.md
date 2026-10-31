# Lessons (project-specific; read before related work)

- Sparta runtime needs Node ≥24; the machine's default `node` is v20 via nvm. Always run Sparta/pnpm with v24.20.0 on PATH (volta default is 24.20.0). The dev runner must exec the right node.
- Sparta `npm i sparta_worlds` resolves 0.8.0 (latest tag); the working build is 0.9.0-beta.5 (beta tag). Pin exact.
- Sparta Zendesk seed: comment ids and audit-event ids share ONE sequence; every ticket needs matching comment + audit (Create event). Validation is strict; unknown fields rejected. Build seeds by editing the bundled zendesk-outcomes-billing-v1.json shape.
- Sparta Stripe charges live inside paid invoices; amounts in cents; two charges on one invoice = duplicate charge; refund via POST /v1/refunds (form-encoded).
- Sparta admin diff needs a mark first: POST /admin/worlds/:id/marks {name}, then GET …/diff?from=<name>.
- Keewano custom-events hash must equal zlib.crc32 of json.dumps(list, sort_keys=True); keys serialize alphabetically (dataType, eventTypeId, name). Verified in a test.
- Keewano wants typed events not logs (strings ≤256 chars). Keep transcripts in our own log keyed by id.
- Egress detection must decode url/base64/hex and scan every string leaf of tool args; phones match on normalized trailing 10 digits with a sliding window.
- Redaction: any phone-shaped value must go through maskPhone (last 2 digits), including when it's passed as a "known secret". Prefix+last4 is for keys only. Test it in services/mole/test/lab.test.ts.
- When bait is planted twice (args + env with the same value), count leaks by unique canary id, never by highlighted rows.
- @fontsource-variable/* export maps turn "./*" into "./*.css": import the bare package (`import "@fontsource-variable/geist"`), never `/index.css`.
- CSS base resets inside a scoped root (`.mole button {…}`) outrank single-class components. Wrap resets in :where().
- The frontend tsconfig lib is ES2022: no Array#findLast. Use a reversed copy.
- vitest runs in worker threads (no process.chdir). Anything that persists to disk takes an injectable dir (RecordStore(dir), new Lab(store)).
- Design: this user wants simple, light and clean. Avoid theatrical effects (grain, outline display type, rotated stamps, scan beams). One accent, only where it carries meaning.

