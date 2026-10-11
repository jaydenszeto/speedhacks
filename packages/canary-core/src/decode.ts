/**
 * Egress normalization: a canary can leave the boundary raw, URL-encoded, base64-encoded or hex-encoded.
 * We expand every outbound string into its plausible decodings before matching (spec §9).
 */
export type Decoding = "raw" | "url" | "base64" | "hex";

export interface Variant {
  text: string;
  decoding: Decoding;
}

const B64_RUN = /[A-Za-z0-9+/_-]{16,}={0,2}/g;
const HEX_RUN = /(?:[0-9a-fA-F]{2}){8,}/g;

function tryUrlDecode(s: string): string | null {
  if (!/%[0-9a-fA-F]{2}|\+/.test(s)) return null;
  try {
    const d = decodeURIComponent(s.replace(/\+/g, " "));
    return d !== s ? d : null;
  } catch {
    return null;
  }
}

function printable(s: string): boolean {
  if (!s) return false;
  let ok = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if ((c >= 32 && c < 127) || c === 10 || c === 13 || c === 9) ok++;
  }
  return ok / s.length > 0.9;
}

export function variants(input: string): Variant[] {
  const out: Variant[] = [{ text: input, decoding: "raw" }];
  const url = tryUrlDecode(input);
  if (url) out.push({ text: url, decoding: "url" });
  for (const src of [input, url].filter(Boolean) as string[]) {
    for (const m of src.match(B64_RUN) ?? []) {
      const norm = m.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = Buffer.from(norm, "base64").toString("utf8");
      if (printable(decoded)) out.push({ text: decoded, decoding: "base64" });
    }
    for (const m of src.match(HEX_RUN) ?? []) {
      const decoded = Buffer.from(m, "hex").toString("utf8");
      if (printable(decoded)) out.push({ text: decoded, decoding: "hex" });
    }
  }
  return out;
}

/** Collect every string leaf of an arbitrary JSON-ish value. */
export function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringLeaves(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => stringLeaves(v, out));
  else if (typeof value === "number") out.push(String(value));
  return out;
}

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}
