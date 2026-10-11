/**
 * Darwin adapter (darwin.so/docs). Search works without a key: POST https://api.darwin.so/api/v3/search.
 * Tripwire uses it for skill provenance: before a run, look up each installed skill/tool in Darwin's index; a skill
 * with no indexed capability is flagged "unverified provenance" on the scenario screen.
 * Gap: Darwin "Publish" is coming soon, so planting decoy listings (fake-directory canaries, spec §5 #7) is mocked.
 */
export interface DarwinMatch { name: string; agentId?: string; capabilityId?: string; readiness?: string; reasons?: string[] }
export interface DarwinResult { mode: "live" | "mock"; query: string; matches: DarwinMatch[]; noMatchReason?: string; error?: string }

export interface DarwinAdapter {
  readonly mode: "live" | "mock";
  search(query: string, maxResults?: number): Promise<DarwinResult>;
}

export class DarwinLive implements DarwinAdapter {
  readonly mode = "live" as const;
  constructor(private apiKey?: string) {}
  async search(query: string, maxResults = 5): Promise<DarwinResult> {
    try {
      const res = await fetch("https://api.darwin.so/api/v3/search", {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({ query, maxResults }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) return { mode: "live", query, matches: [], error: `HTTP ${res.status}` };
      const body = (await res.json()) as { response?: { agents?: Array<Record<string, unknown>>; noMatchReason?: string } };
      const agents = body.response?.agents ?? [];
      return {
        mode: "live",
        query,
        noMatchReason: body.response?.noMatchReason,
        matches: agents.map((a) => ({ name: String(a.name ?? ""), agentId: a.agentId as string | undefined, capabilityId: a.capabilityId as string | undefined, readiness: typeof a.readiness === "string" ? a.readiness : JSON.stringify(a.readiness ?? null), reasons: Array.isArray(a.reasons) ? (a.reasons as string[]).slice(0, 3) : [] })),
      };
    } catch (e) {
      return { mode: "live", query, matches: [], error: (e as Error).message };
    }
  }
}

export class DarwinMock implements DarwinAdapter {
  readonly mode = "mock" as const;
  async search(query: string): Promise<DarwinResult> {
    return { mode: "mock", query, matches: [], noMatchReason: "offline (DEMO_FALLBACK): no indexed capability found" };
  }
}
