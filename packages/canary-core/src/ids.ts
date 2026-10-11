import { randomBytes, createHash } from "node:crypto";

/** Crockford base32 alphabet: no I, L, O, U, so ids survive being read aloud or retyped. */
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A short random canary id, e.g. "K7Q2MX". 6 chars = 30 bits, plenty for a run. */
export function canaryId(len = 6): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += CROCKFORD[bytes[i]! % 32];
  return out;
}

/** A deterministic pseudo-random generator seeded from a string (mulberry32 over a sha256 seed). */
export function rng(seed: string): () => number {
  let a = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(r: () => number, items: readonly T[]): T {
  return items[Math.floor(r() * items.length)]!;
}

export function randomChars(r: () => number, alphabet: string, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(r() * alphabet.length)];
  return s;
}

export function shortId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}
