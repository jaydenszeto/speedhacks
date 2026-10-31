/**
 * Planted identities: catch which vendor leaked or sold your data.
 *
 * Give every vendor, processor or AI provider its own minted person: name, email, phone, street address, and a
 * one-off phrase. Nobody else ever sees that identity. If any of it later turns up (a spam email, a breach dump, a
 * data-broker list, an AI model's output), the ledger says exactly which vendor it was handed to.
 *
 *   mint(vendor)    a fresh identity, recorded in .mole/identities.json
 *   check(text)     scan any text for every identity on the ledger → sightings, each naming its vendor
 *
 * Strong fields only (email, phone, unit number, phrase): names alone are never treated as a sighting, because names
 * collide. Real use needs a mail domain you control (MOLE_IDENTITY_DOMAIN) so spam to these addresses reaches you;
 * the lab uses the reserved .example TLD. Phones default to the reserved fictional 555-01XX range, because a random
 * "realistic" number could belong to a real person who would then get the spam; pass a number you control instead.
 *
 * runIdentityLab() runs the whole loop for real against the planted vendors in fixtures/vendors.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canaryId, digitsOnly, prettyPhone } from "@tripwire/canary-core";
import { maskPhone } from "../format.js";
import { REPO, dataDir, nodeArgs } from "./assets.js";


export interface Identity {
  id: string;
  vendor: string;
  purpose: string;
  issuedAt: string;
  source: "lab" | "cli";
  first: string;
  last: string;
  email: string;
  phone: string;
  address: string;
  /** A one-off phrase for vendors you talk to (support chats, AI assistants). */
  phrase: string;
}

export type SightingField = "email" | "phone" | "address" | "phrase";
export interface Sighting { identityId: string; vendor: string; fields: SightingField[]; source: string }

const FIRST = ["Noor", "Jonah", "Mireille", "Tomasz", "Ayo", "Leila", "Bram", "Sunniva", "Caio", "Ines"];
const LAST = ["Castellane", "Vukovic", "Adebayo", "Kerrigan", "Hollis", "Sandoval", "Okonjo", "Pellegrini", "Marsh", "Tanaka"];
const STREETS = ["Alder St", "Linden Ave", "Quarry Rd", "Harbor View Dr", "Fennel Ct", "Orchard Ln"];
const WORDS = ["copper", "lantern", "orchid", "granite", "meadow", "falcon", "harbor", "velvet", "cinder", "juniper"];

/** +1 AAA 555 01XX: the NANP block reserved for fiction, so no real person is ever handed to a vendor. */
function fictionalPhone(id: string): string {
  const area = ["415", "628", "510", "650", "212", "312"][id.charCodeAt(1) % 6]!;
  const n = ((id.charCodeAt(2) * 31 + id.charCodeAt(3) * 7 + id.charCodeAt(4)) % 100).toString().padStart(2, "0");
  return `+1${area}55501${n}`;
}

const pickBy = <T,>(xs: readonly T[], id: string, salt: number) => xs[(id.charCodeAt(salt % id.length) + salt) % xs.length]!;

/** Mask an identity for display: never print a full email or phone. */
export function maskIdentity(i: Identity) {
  return {
    id: i.id, vendor: i.vendor, purpose: i.purpose, issuedAt: i.issuedAt, source: i.source,
    name: `${i.first} ${i.last}`, email: i.email.replace(/^(.{3}).*(@.*)$/, "$1•••$2"), phone: maskPhone(i.phone),
    address: i.address.replace(/^\d+/, "•••"), phrase: `${i.phrase.split("-")[0]}-•••`,
  };
}

export class IdentityLedger {
  private items: Identity[] = [];
  private readonly file: string;

  constructor(private readonly dir = dataDir()) {
    this.file = join(dir, "identities.json");
    try { if (existsSync(this.file)) this.items = (JSON.parse(readFileSync(this.file, "utf8")) as { identities: Identity[] }).identities ?? []; } catch { this.items = []; }
  }

  private save() { mkdirSync(this.dir, { recursive: true }); writeFileSync(this.file, JSON.stringify({ identities: this.items }, null, 2)); }

  mint(vendor: string, purpose = "signup", opts: { domain?: string; phone?: string; source?: Identity["source"] } = {}): Identity {
    const id = canaryId(6);
    const domain = opts.domain ?? process.env.MOLE_IDENTITY_DOMAIN ?? "mole-canary.example";
    const first = pickBy(FIRST, id, 1), last = pickBy(LAST, id, 2);
    const i: Identity = {
      id, vendor, purpose, issuedAt: new Date().toISOString(), source: opts.source ?? "cli", first, last,
      email: `${first.toLowerCase()}.${last.toLowerCase()}.${id.toLowerCase()}@${domain}`,
      phone: opts.phone ?? fictionalPhone(id),
      address: `${100 + (id.charCodeAt(0) * 7) % 900} ${pickBy(STREETS, id, 3)}, Unit ${id}`,
      phrase: `${pickBy(WORDS, id, 4)}-${pickBy(WORDS, id, 5)}-${id.toLowerCase()}`,
    };
    this.items.push(i);
    this.save();
    return i;
  }

  all(): Identity[] { return [...this.items]; }

  /** For shared persistence (persist.ts): the full set, and a union-by-id merge. */
  snapshot(): Identity[] { return [...this.items]; }
  merge(items: Identity[]): void {
    const have = new Set(this.items.map((i) => i.id));
    const fresh = items.filter((i) => !have.has(i.id));
    if (!fresh.length) return;
    this.items = [...this.items, ...fresh].sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
    this.save();
  }

  /** Scan text for every identity on the ledger. `source` labels where the text came from. */
  check(text: string, source = "text"): Sighting[] {
    const lower = text.toLowerCase();
    const digitWindows = new Set<string>();
    for (const m of text.match(/\+?\(?\d[\d\s().-]{8,18}\d/g) ?? []) {
      const d = digitsOnly(m);
      for (let k = 0; k + 10 <= d.length; k++) digitWindows.add(d.slice(k, k + 10));
    }
    const out: Sighting[] = [];
    for (const i of this.items) {
      const fields: SightingField[] = [];
      if (lower.includes(i.email.toLowerCase())) fields.push("email");
      if (digitWindows.has(digitsOnly(i.phone).slice(-10))) fields.push("phone");
      if (lower.includes(`unit ${i.id.toLowerCase()}`)) fields.push("address");
      if (lower.includes(i.phrase.toLowerCase())) fields.push("phrase");
      if (fields.length) out.push({ identityId: i.id, vendor: i.vendor, fields, source });
    }
    return out;
  }
}

/* ── The lab run: planted vendors, real handoffs, real sweeps ─────────────────────────────────────────────────── */

export const LAB_VENDORS = [
  { id: "lab-newsletter", name: "lab-newsletter", does: "Newsletter signup", channel: "signup form", path: "/newsletter/signup" },
  { id: "lab-crm", name: "lab-crm", does: "CRM trial signup", channel: "signup form", path: "/crm/signup" },
  { id: "lab-ai-assistant", name: "lab-ai-assistant", does: "AI support assistant", channel: "support chat", path: "/assistant/chat" },
] as const;

export type IdentityEvent =
  | { type: "world"; vendors: { id: string; does: string; channel: string }[] }
  | { type: "minted"; vendor: string; identity: ReturnType<typeof maskIdentity> }
  | { type: "handoff"; vendor: string; channel: string; status: number }
  | { type: "sweep"; source: string; detail: string; bytes: number }
  | { type: "sighting"; sighting: Sighting }
  | { type: "summary"; sightings: Sighting[]; quiet: string[] }
  | { type: "error"; message: string };

export async function runIdentityLab(ledger: IdentityLedger, emit: (e: IdentityEvent) => void): Promise<Sighting[]> {
  const vendors = resolve(REPO, "services/mole/fixtures/vendors/server.ts");
  const child = spawn(process.execPath, nodeArgs(vendors), {
    cwd: REPO, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" }, stdio: ["ignore", "pipe", "ignore"],
  });
  try {
    const port = await new Promise<number>((done, fail) => {
      const t = setTimeout(() => fail(new Error("vendor world didn't start")), 15000);
      child.stdout!.on("data", (b) => { const m = String(b).match(/READY (\d+)/); if (m) { clearTimeout(t); done(Number(m[1])); } });
      child.on("exit", () => fail(new Error("vendor world exited")));
    });
    const base = `http://127.0.0.1:${port}`;
    emit({ type: "world", vendors: LAB_VENDORS.map((v) => ({ id: v.id, does: v.does, channel: v.channel })) });

    const minted: Identity[] = [];
    for (const v of LAB_VENDORS) {
      const i = ledger.mint(v.id, v.does, { source: "lab" });
      minted.push(i);
      emit({ type: "minted", vendor: v.id, identity: maskIdentity(i) });
      const payload = v.channel === "support chat"
        ? { message: `Hi, I'm ${i.first} ${i.last} (${i.email}). My account recovery phrase is ${i.phrase}. Can you reset my login?` }
        : { name: `${i.first} ${i.last}`, email: i.email, phone: prettyPhone(i.phone), address: i.address };
      const r = await fetch(`${base}${v.path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      emit({ type: "handoff", vendor: v.id, channel: v.channel, status: r.status });
    }

    const sightings: Sighting[] = [];
    const record = (list: Sighting[]) => {
      for (const s of list) {
        if (!minted.some((m) => m.id === s.identityId)) continue; // this run's identities only
        if (sightings.some((x) => x.identityId === s.identityId && x.source === s.source)) continue;
        sightings.push(s);
        emit({ type: "sighting", sighting: s });
      }
    };

    // Source 1: the data broker's public list.
    const list = await (await fetch(`${base}/broker/list`)).text();
    emit({ type: "sweep", source: "data broker list (lab)", detail: `${list.trim().split("\n").length - 1} people listed`, bytes: Buffer.byteLength(list) });
    record(ledger.check(list, "data broker list (lab)"));

    // Source 2: probe the AI assistant with the start of what we told it, and see if it finishes the sentence.
    const completion = (await (await fetch(`${base}/assistant/complete?prompt=${encodeURIComponent("account recovery phrase is")}`)).json()) as { completion: string };
    emit({ type: "sweep", source: "lab-ai-assistant completions", detail: "prompted: \"…account recovery phrase is\"", bytes: Buffer.byteLength(completion.completion) });
    record(ledger.check(completion.completion, "lab-ai-assistant completions"));

    const quiet = LAB_VENDORS.map((v) => v.id).filter((v) => !sightings.some((s) => s.vendor === v));
    emit({ type: "summary", sightings, quiet });
    return sightings;
  } catch (e) {
    emit({ type: "error", message: (e as Error).message });
    return [];
  } finally {
    child.kill();
  }
}
