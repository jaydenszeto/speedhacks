/**
 * Pure helpers shared by both sandbox runners (Docker in sandbox.ts, Vercel Sandbox microVMs in microvm.ts).
 * No I/O beyond reading the observer's egress log, so the microVM runner can bundle this without the Docker code.
 */
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import type { ProxyRequest } from "../proxy.js";

/** npm package spec guard: a name and version we're willing to splice into an install command. */
export function safeSpec(pkg: string, version: string): boolean {
  return /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(pkg) && /^[\w.+-]+$/.test(version);
}

/** The runnable entry of an installed package, relative to the install dir (node_modules/<pkg>/<bin>). */
export function binFromPackageJson(pj: { bin?: string | Record<string, string>; main?: string }, pkg: string): string | undefined {
  const short = pkg.split("/").pop()!;
  const rel = typeof pj.bin === "string" ? pj.bin : pj.bin?.[short] ?? (pj.bin ? Object.values(pj.bin)[0] : pj.main);
  return rel ? posix.join("node_modules", pkg, rel) : undefined;
}

/** Read the observer's egress log back as proxy requests (re-read each call; the file is small). */
export function readEgress(file: string): ProxyRequest[] {
  if (!existsSync(file)) return [];
  const out: ProxyRequest[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as Partial<ProxyRequest>;
      out.push({ at: o.at ?? Date.now(), scheme: o.scheme === "https" ? "https" : "http", method: o.method ?? "GET", url: o.url ?? "", host: o.host ?? "", headers: o.headers ?? {}, body: o.body ?? "" });
    } catch { /* partial line */ }
  }
  return out;
}
