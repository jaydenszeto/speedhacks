/**
 * Keewano (KeewanoDB) adapter — docs.keewano.com.
 *   Write: POST https://api.keewano.com/event/ingress/v1/json/in   (header k-token: <SDK API key>)
 *          POST …/json/custom registers our custom event map once (idempotent; 200/202 ok, 409 = different map).
 *   Read:  Postgres wire protocol at pgsql.keewano.com:27543, db = project UUID, user = login email, password = kwpat PAT.
 *          One `events` table; every event name is a column (quoted), columns are step functions.
 * Keewano wants small typed events, not logs, so we emit categorical events (ToolCalled("send_email"), TripFired("secret"))
 * and keep raw transcripts in our own ordered log. New events take ~5 minutes to become queryable, so live kill-chain
 * replay reads our local log; Keewano answers the cross-run questions (which lures trip which models, which skills trip).
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";

export const KEEWANO_INGEST = "https://api.keewano.com/event/ingress/v1/json";

/** Append-only custom event map. Never change an existing entry's type; add new ids instead. */
export const CUSTOM_EVENTS = [
  { eventTypeId: 2000, name: "RunStarted", dataType: "string" },
  { eventTypeId: 2001, name: "AgentRole", dataType: "string" },
  { eventTypeId: 2002, name: "AgentModel", dataType: "string" },
  { eventTypeId: 2003, name: "SkillLoaded", dataType: "string" },
  { eventTypeId: 2004, name: "Fleet", dataType: "string" },
  { eventTypeId: 2005, name: "TicketOpened", dataType: "string" },
  { eventTypeId: 2006, name: "ToolCalled", dataType: "string" },
  { eventTypeId: 2007, name: "CanaryExposed", dataType: "string" },
  { eventTypeId: 2008, name: "TripFired", dataType: "string" },
  { eventTypeId: 2009, name: "TripActor", dataType: "string" },
  { eventTypeId: 2010, name: "BreakerThrown", dataType: "string" },
  { eventTypeId: 2011, name: "StepIndex", dataType: "uint" },
  { eventTypeId: 2012, name: "UtilityPercent", dataType: "uint" },
  { eventTypeId: 2013, name: "RunFinished", dataType: "none" },
] as const;

export type KeewanoEventName = (typeof CUSTOM_EVENTS)[number]["name"];
const BY_NAME = new Map(CUSTOM_EVENTS.map((e) => [e.name, e]));

/** zlib.crc32(json.dumps(CUSTOM_EVENTS, sort_keys=True)) or 1 — matches the documented Python recipe byte for byte. */
export function customEventsHash(): number {
  const json = "[" + CUSTOM_EVENTS.map((e) => `{"dataType": "${e.dataType}", "eventTypeId": ${e.eventTypeId}, "name": "${e.name}"}`).join(", ") + "]";
  return crc32(Buffer.from(json)) || 1;
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

/** UUID v5 (URL namespace) so the same session string always maps to the same Keewano entity. */
export function uuidv5(name: string): string {
  const ns = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
  const h = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name)])).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export interface KwEvent {
  name: KeewanoEventName;
  value?: string | number | null;
  /** Unix seconds. */
  ts: number;
}

export interface FleetIntel {
  source: "keewano" | "local";
  generatedAt: string;
  /** Skills ranked by how many trips happened while they were loaded. */
  skills: { skill: string; trips: number }[];
  /** Trip counts per (model, canary type), plus exposures, so the UI can show trip rates. */
  lures: { model: string; canaryType: string; trips: number; exposures: number }[];
  sql: string[];
  error?: string;
}

export interface KeewanoAdapter {
  readonly mode: "live" | "mock";
  health(): Promise<{ ok: boolean; detail: string }>;
  /** Ship one entity's ordered events. Safe to retry (idempotent per dataSessionId + batch). */
  ingest(entityKey: string, events: KwEvent[]): Promise<{ accepted: number; mirrored: boolean; error?: string }>;
  fleetIntel(): Promise<FleetIntel>;
  /** Run a read-only SQL query (live only). */
  sql(query: string): Promise<Record<string, unknown>[]>;
}

export const FLEET_SQL = {
  skills: `SELECT "SkillLoaded" AS skill, count("TripFired") AS trips FROM events WHERE "SkillLoaded" IS NOT NULL AND "TripFired" IS NOT NULL GROUP BY "SkillLoaded" ORDER BY trips DESC LIMIT 20`,
  trips: `SELECT "AgentModel" AS model, "TripFired" AS canary_type, count("TripFired") AS trips FROM events WHERE "TripFired" IS NOT NULL AND "AgentModel" IS NOT NULL GROUP BY "AgentModel", "TripFired"`,
  exposures: `SELECT "AgentModel" AS model, "CanaryExposed" AS canary_type, count("CanaryExposed") AS exposures FROM events WHERE "CanaryExposed" IS NOT NULL AND "AgentModel" IS NOT NULL GROUP BY "AgentModel", "CanaryExposed"`,
};

/* ─────────────────────── local mirror ─────────────────────── */

/**
 * Every ingested event is also appended to a local JSONL mirror. It is the offline fallback for fleet intel and
 * the record of exactly what we sent.
 */
export class LocalMirror {
  constructor(private path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }
  append(entity: string, events: KwEvent[]) {
    const lines = events.map((e) => JSON.stringify({ entity, ...e })).join("\n");
    if (lines) appendFileSync(this.path, lines + "\n");
  }
  read(): ({ entity: string } & KwEvent)[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }
  /** Same semantics as the Keewano SQL: step-function columns per entity, counted at each trip/exposure. */
  intel(): FleetIntel {
    const byEntity = new Map<string, ({ entity: string } & KwEvent)[]>();
    for (const e of this.read()) {
      const list = byEntity.get(e.entity) ?? [];
      list.push(e);
      byEntity.set(e.entity, list);
    }
    const skills = new Map<string, number>();
    const lures = new Map<string, { model: string; canaryType: string; trips: number; exposures: number }>();
    for (const events of byEntity.values()) {
      events.sort((a, b) => a.ts - b.ts);
      let model: string | null = null;
      let skill: string | null = null;
      for (const e of events) {
        if (e.name === "AgentModel") model = String(e.value);
        if (e.name === "SkillLoaded") skill = String(e.value);
        if ((e.name === "TripFired" || e.name === "CanaryExposed") && model) {
          const key = `${model}|${e.value}`;
          const row = lures.get(key) ?? { model, canaryType: String(e.value), trips: 0, exposures: 0 };
          if (e.name === "TripFired") row.trips++;
          else row.exposures++;
          lures.set(key, row);
        }
        if (e.name === "TripFired" && skill) skills.set(skill, (skills.get(skill) ?? 0) + 1);
      }
    }
    return {
      source: "local",
      generatedAt: new Date().toISOString(),
      skills: [...skills.entries()].map(([skill, trips]) => ({ skill, trips })).sort((a, b) => b.trips - a.trips),
      lures: [...lures.values()],
      sql: Object.values(FLEET_SQL),
    };
  }
}

/* ───────────────────────── real ───────────────────────── */

export interface KeewanoLiveConfig {
  apiKey: string;
  pat?: string;
  projectId?: string;
  email?: string;
  mirrorPath: string;
}

export class KeewanoLive implements KeewanoAdapter {
  readonly mode = "live" as const;
  private registered: Promise<void> | null = null;
  private batches = new Map<string, { dataSessionId: string; batch: number }>();
  readonly mirror: LocalMirror;

  constructor(private cfg: KeewanoLiveConfig) {
    this.mirror = new LocalMirror(cfg.mirrorPath);
  }

  private async post(path: string, body: unknown): Promise<Response> {
    return fetch(`${KEEWANO_INGEST}/${path}`, {
      method: "POST",
      headers: { "k-token": this.cfg.apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  }

  private register(): Promise<void> {
    this.registered ??= (async () => {
      const res = await this.post("custom", { customEventsHash: customEventsHash(), eventTypes: CUSTOM_EVENTS });
      if (res.status === 409) throw new Error("Keewano: a different custom-event map is registered under this hash");
      if (![200, 202].includes(res.status)) throw new Error(`Keewano custom registration HTTP ${res.status}: ${await res.text()}`);
    })().catch((e) => { this.registered = null; throw e; });
    return this.registered;
  }

  async health() {
    const parts: string[] = [];
    let ok = true;
    try {
      await this.register();
      parts.push("ingest ok");
    } catch (e) {
      ok = false;
      parts.push(`ingest: ${(e as Error).message}`);
    }
    if (this.cfg.pat && this.cfg.projectId && this.cfg.email) {
      try {
        await this.sql("SELECT count(*) AS n FROM events");
        parts.push("sql ok");
      } catch (e) {
        ok = false;
        parts.push(`sql: ${(e as Error).message}`);
      }
    } else parts.push("sql not configured (KEEWANO_PAT / KEEWANO_PROJECT_ID / KEEWANO_EMAIL)");
    return { ok, detail: parts.join(" · ") };
  }

  async ingest(entityKey: string, events: KwEvent[]) {
    this.mirror.append(entityKey, events);
    if (!events.length) return { accepted: 0, mirrored: true };
    try {
      await this.register();
      const state = this.batches.get(entityKey) ?? { dataSessionId: randomUUID(), batch: 0 };
      state.batch++;
      this.batches.set(entityKey, state);
      const res = await this.post("in", {
        dataSessionId: state.dataSessionId,
        batch: state.batch,
        customEventsHash: customEventsHash(),
        installId: uuidv5(entityKey),
        sdkVersion: "tripwire/0.1",
        events: events.map((e) => toWire(e)),
      });
      if (res.status !== 202 && res.status !== 200) return { accepted: 0, mirrored: true, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
      const body = (await res.json().catch(() => ({}))) as { accepted?: number };
      return { accepted: body.accepted ?? events.length, mirrored: true };
    } catch (e) {
      return { accepted: 0, mirrored: true, error: (e as Error).message };
    }
  }

  async sql(query: string): Promise<Record<string, unknown>[]> {
    const { pat, projectId, email } = this.cfg;
    if (!pat || !projectId || !email) throw new Error("Keewano SQL needs KEEWANO_PAT, KEEWANO_PROJECT_ID and KEEWANO_EMAIL");
    const client = new pg.Client({ host: "pgsql.keewano.com", port: 27543, database: projectId, user: email, password: pat, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 8000, statement_timeout: 60_000 });
    await client.connect();
    try {
      return (await client.query(query)).rows as Record<string, unknown>[];
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async fleetIntel(): Promise<FleetIntel> {
    try {
      const [skills, trips, exposures] = await Promise.all([this.sql(FLEET_SQL.skills), this.sql(FLEET_SQL.trips), this.sql(FLEET_SQL.exposures)]);
      const lures = new Map<string, { model: string; canaryType: string; trips: number; exposures: number }>();
      for (const r of trips) lures.set(`${r.model}|${r.canary_type}`, { model: String(r.model), canaryType: String(r.canary_type), trips: Number(r.trips), exposures: 0 });
      for (const r of exposures) {
        const key = `${r.model}|${r.canary_type}`;
        const row = lures.get(key) ?? { model: String(r.model), canaryType: String(r.canary_type), trips: 0, exposures: 0 };
        row.exposures = Number(r.exposures);
        lures.set(key, row);
      }
      return { source: "keewano", generatedAt: new Date().toISOString(), skills: skills.map((r) => ({ skill: String(r.skill), trips: Number(r.trips) })), lures: [...lures.values()], sql: Object.values(FLEET_SQL) };
    } catch (e) {
      return { ...this.mirror.intel(), error: `Keewano query failed, using local mirror: ${(e as Error).message}` };
    }
  }
}

function toWire(e: KwEvent) {
  const def = BY_NAME.get(e.name);
  if (!def) throw new Error(`unknown Keewano event ${e.name}`);
  const base = { eventTypeId: def.eventTypeId, dataType: def.dataType, timestamp: Math.floor(e.ts) };
  if (def.dataType === "none") return base;
  if (def.dataType === "uint") return { ...base, data: Math.max(0, Math.floor(Number(e.value ?? 0))) };
  return { ...base, data: String(e.value ?? "").slice(0, 256) };
}

/* ───────────────────────── mock ───────────────────────── */

export class KeewanoMock implements KeewanoAdapter {
  readonly mode = "mock" as const;
  readonly mirror: LocalMirror;
  constructor(mirrorPath: string) { this.mirror = new LocalMirror(mirrorPath); }
  async health() { return { ok: true, detail: "local mirror only (no KEEWANO_API_KEY)" }; }
  async ingest(entityKey: string, events: KwEvent[]) { this.mirror.append(entityKey, events); return { accepted: events.length, mirrored: true }; }
  async fleetIntel() { return this.mirror.intel(); }
  async sql(): Promise<Record<string, unknown>[]> { throw new Error("Keewano SQL unavailable in mock mode"); }
}
