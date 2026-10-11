import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOM_EVENTS, KeewanoMock, customEventsHash, normalizeDialEvent, uuidv5, DialMock, alertInstruction } from "../src/index.js";

describe("keewano", () => {
  it("computes the same custom-events hash as the documented Python recipe", () => {
    const py = execFileSync("python3", ["-I", "-c", `import json,zlib,sys; ev=json.loads(sys.argv[1]); print(zlib.crc32(json.dumps(ev, sort_keys=True).encode()) or 1)`, JSON.stringify(CUSTOM_EVENTS)]).toString().trim();
    expect(customEventsHash()).toBe(Number(py));
  });

  it("derives RFC 4122 v5 UUIDs (matches python uuid.uuid5)", () => {
    const py = execFileSync("python3", ["-I", "-c", "import uuid; print(uuid.uuid5(uuid.NAMESPACE_URL, 'machine-7'))"]).toString().trim();
    expect(uuidv5("machine-7")).toBe(py);
  });

  it("local mirror computes fleet intel with step-function semantics", async () => {
    const kw = new KeewanoMock(join(mkdtempSync(join(tmpdir(), "kw-")), "mirror.jsonl"));
    await kw.ingest("s1", [
      { name: "AgentModel", value: "claude-haiku-5-5", ts: 1 },
      { name: "CanaryExposed", value: "injection_bait", ts: 2 },
      { name: "TripFired", value: "injection_bait", ts: 3 },
    ]);
    await kw.ingest("s2", [
      { name: "AgentModel", value: "claude-opus-5-5", ts: 1 },
      { name: "SkillLoaded", value: "ticket-summarizer@2.3.1", ts: 2 },
      { name: "CanaryExposed", value: "secret", ts: 3 },
      { name: "TripFired", value: "secret", ts: 4 },
    ]);
    const intel = await kw.fleetIntel();
    expect(intel.skills).toEqual([{ skill: "ticket-summarizer@2.3.1", trips: 1 }]);
    expect(intel.lures).toContainEqual({ model: "claude-haiku-5-5", canaryType: "injection_bait", trips: 1, exposures: 1 });
  });
});

describe("dial", () => {
  it("normalizes inbound call and sms events, ignoring outbound and follow-up states", () => {
    expect(normalizeDialEvent({ id: "e1", type: "message.received", data: { messageId: "m1", from: "+1415", to: "+1628", body: "hi" } })?.kind).toBe("sms");
    expect(normalizeDialEvent({ id: "e2", type: "call.status_changed", data: { callId: "c1", direction: "inbound", from: "a", to: "b", previousState: null, status: { state: "Ringing" } } })?.kind).toBe("call");
    expect(normalizeDialEvent({ id: "e3", type: "call.status_changed", data: { callId: "c1", direction: "inbound", previousState: "Ringing", status: { state: "InProgress" } } })).toBeNull();
    expect(normalizeDialEvent({ id: "e4", type: "call.status_changed", data: { callId: "c2", direction: "outbound", previousState: null } })).toBeNull();
  });

  it("mock canary call fires an inbound event for the dialed number", async () => {
    const dial = new DialMock("+14155550100", ["+16285550188"]);
    const got = new Promise((resolve) => dial.listen((c) => resolve(c)));
    await dial.dialCanary({ to: "+16285550188", idempotencyKey: "k" });
    expect(await got).toMatchObject({ kind: "call", to: "+16285550188" });
  });

  it("alert instruction reads the script verbatim and refuses side conversations", () => {
    const s = alertInstruction("Tripwire alert: agent Eager called an unknown number.");
    expect(s).toContain('"Tripwire alert: agent Eager called an unknown number."');
    expect(s).toMatch(/Do not ask questions/);
  });
});
