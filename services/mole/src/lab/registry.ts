/**
 * The marketplace Mole crawls: the official MCP Registry (registry.modelcontextprotocol.io), read-only.
 * Listings are normalized into one shape, and each gets an honest runnability call: Mole can trial npm packages over
 * stdio in its sandbox; remote servers and other package types are indexed but not executed (yet).
 *
 * Required env vars from the listing (API keys etc.) are filled with bait at trial time, so a server that ships its
 * own credentials somewhere it shouldn't is caught.
 */

export const REGISTRY = "https://registry.modelcontextprotocol.io/v0";

export type ListingKind = "npm" | "pypi" | "oci" | "remote" | "other" | "lab" | "integration";

export interface Listing {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string;
  kind: ListingKind;
  pkg?: { identifier: string; version: string; transport: string; requiredEnv: string[]; requiredArgs: string[] };
  remotes: string[];
  repo?: string;
  website?: string;
  publishedAt?: string;
  /** Why Mole can or can't run this one right now. */
  runnable: boolean;
  runnableNote: string;
  /** Present on the lab's own planted test cases (never on registry listings). */
  lab?: { note: string; versions: string[]; entry: string; envVersion?: boolean };
  /** Present on SaaS / AI integrations, which are trialed against a bait tenant instead of probed as MCP servers. */
  integration?: IntegrationSpec;
}

/** What an integration says it does. Mole checks it against what the tenant saw it read and where data went. */
export interface IntegrationSpec {
  platform: string;
  task: string;
  scopes: { read: string[]; write: string[] };
  /** Hosts the integration declares as its own (data sent there is expected use). */
  domains: string[];
}

interface RawPackage {
  registryType?: string; identifier?: string; version?: string;
  transport?: { type?: string };
  environmentVariables?: { name: string; isRequired?: boolean }[];
  packageArguments?: { name?: string; value?: string; isRequired?: boolean; type?: string }[];
}
interface RawServer {
  name: string; title?: string; description?: string; version: string;
  packages?: RawPackage[]; remotes?: { type?: string; url?: string }[];
  repository?: { url?: string }; websiteUrl?: string;
}
interface RawEntry { server: RawServer; _meta?: Record<string, { publishedAt?: string } | undefined> }
interface RawPage { servers: RawEntry[]; metadata?: { nextCursor?: string; count?: number } }

export function normalize(entry: RawEntry): Listing {
  const s = entry.server;
  const npm = s.packages?.find((p) => p.registryType === "npm");
  const anyPkg = npm ?? s.packages?.[0];
  const kind: ListingKind = npm ? "npm"
    : anyPkg?.registryType === "pypi" ? "pypi"
    : anyPkg?.registryType === "oci" ? "oci"
    : s.remotes?.length ? "remote" : "other";
  const pkg = anyPkg?.identifier ? {
    identifier: anyPkg.identifier,
    version: anyPkg.version ?? s.version,
    transport: anyPkg.transport?.type ?? "stdio",
    requiredEnv: (anyPkg.environmentVariables ?? []).filter((e) => e.isRequired).map((e) => e.name),
    requiredArgs: (anyPkg.packageArguments ?? []).filter((a) => a.isRequired && !a.value).map((a) => a.name ?? "arg"),
  } : undefined;

  let runnable = false;
  let runnableNote: string;
  if (kind === "npm" && pkg && pkg.transport === "stdio" && pkg.requiredArgs.length === 0) {
    runnable = true;
    runnableNote = pkg.requiredEnv.length ? `sandbox · ${pkg.requiredEnv.length} required key${pkg.requiredEnv.length > 1 ? "s" : ""} filled with bait` : "sandbox";
  } else if (kind === "npm" && pkg && pkg.transport !== "stdio") runnableNote = `npm over ${pkg.transport}: not yet`;
  else if (kind === "npm") runnableNote = "needs launch arguments";
  else if (kind === "remote") runnableNote = "remote server: indexed, not executed";
  else runnableNote = `${kind} package: runner not built yet`;

  const meta = entry._meta?.["io.modelcontextprotocol.registry/official"];
  return {
    id: s.name,
    name: s.name,
    title: s.title || s.name.split("/").pop() || s.name,
    description: (s.description ?? "").slice(0, 220),
    version: s.version,
    kind,
    pkg,
    remotes: (s.remotes ?? []).map((r) => r.url ?? "").filter(Boolean),
    repo: s.repository?.url,
    website: s.websiteUrl,
    publishedAt: meta?.publishedAt,
    runnable,
    runnableNote,
  };
}

export async function fetchPage(cursor?: string, limit = 100, search?: string): Promise<{ listings: Listing[]; next?: string }> {
  const u = new URL(`${REGISTRY}/servers`);
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("version", "latest");
  if (cursor) u.searchParams.set("cursor", cursor);
  if (search) u.searchParams.set("search", search);
  const res = await fetch(u, { signal: AbortSignal.timeout(20000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`registry responded ${res.status}`);
  const page = (await res.json()) as RawPage;
  return { listings: page.servers.map(normalize), next: page.metadata?.nextCursor };
}

/** Every published version of one server name (oldest first), for release watch. */
export async function fetchVersions(name: string): Promise<Listing[]> {
  const u = new URL(`${REGISTRY}/servers`);
  u.searchParams.set("search", name);
  u.searchParams.set("limit", "100");
  const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`registry responded ${res.status}`);
  const page = (await res.json()) as RawPage;
  return page.servers
    .filter((e) => e.server.name === name)
    .map(normalize)
    .sort((a, b) => (a.publishedAt ?? "").localeCompare(b.publishedAt ?? ""));
}

export async function pingRegistry(): Promise<{ ok: boolean; ms: number; detail: string }> {
  const t = Date.now();
  try {
    const res = await fetch(`${REGISTRY}/servers?limit=1`, { signal: AbortSignal.timeout(8000) });
    return { ok: res.ok, ms: Date.now() - t, detail: res.ok ? "reachable" : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, detail: (e as Error).message };
  }
}

/** Registrable domain (last two labels) for "did the data go to the service's own API?" checks. */
export function rootDomain(host: string): string {
  const h = host.replace(/:\d+$/, "").toLowerCase();
  const parts = h.split(".").filter(Boolean);
  return parts.slice(-2).join(".");
}

/** Domains a listing declares as its own (website, remotes, reverse-DNS namespace). Data sent there is expected use. */
export function declaredDomains(l: Listing): Set<string> {
  const out = new Set<string>();
  const add = (url?: string) => { try { if (url) out.add(rootDomain(new URL(url).host)); } catch { /* ignore */ } };
  add(l.website);
  l.remotes.forEach(add);
  const ns = l.name.split("/")[0] ?? "";
  if (ns && !ns.startsWith("io.github.") && ns.includes(".")) out.add(ns.split(".").reverse().slice(-2).join(".").toLowerCase());
  for (const d of l.integration?.domains ?? []) out.add(rootDomain(d));
  out.delete("github.com");
  return out;
}
