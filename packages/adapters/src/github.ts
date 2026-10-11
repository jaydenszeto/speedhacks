/**
 * GitHub-watch detector (callback-free detection). Many leaks never call home — a scraped secret ends up pasted into a
 * public repo or gist. This searches public GitHub code for a canary string; a hit proves the canary left the building
 * even though nothing ever hit our collector. Real via the GitHub code-search API (needs GITHUB_TOKEN); mock otherwise.
 */
export interface GithubHit { canaryId: string; repo: string; path: string; url: string }

export interface GithubWatcher {
  readonly mode: "live" | "mock";
  /** Search public GitHub for the given canary strings. Returns hits (empty if none / unavailable). */
  search(needles: { canaryId: string; value: string }[]): Promise<GithubHit[]>;
}

export class GithubLive implements GithubWatcher {
  readonly mode = "live" as const;
  constructor(private token: string) {}
  async search(needles: { canaryId: string; value: string }[]): Promise<GithubHit[]> {
    const hits: GithubHit[] = [];
    for (const n of needles.slice(0, 5)) {
      try {
        const res = await fetch(`https://api.github.com/search/code?q=${encodeURIComponent(`"${n.value}"`)}`, {
          headers: { authorization: `Bearer ${this.token}`, accept: "application/vnd.github+json", "user-agent": "tripwire" },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const body = (await res.json()) as { items?: Array<{ repository?: { full_name?: string }; path?: string; html_url?: string }> };
        for (const it of body.items ?? []) hits.push({ canaryId: n.canaryId, repo: it.repository?.full_name ?? "", path: it.path ?? "", url: it.html_url ?? "" });
      } catch {
        /* ignore and keep going */
      }
    }
    return hits;
  }
}

export class GithubMock implements GithubWatcher {
  readonly mode = "mock" as const;
  async search(): Promise<GithubHit[]> { return []; }
}

export function buildGithubWatcher(env: NodeJS.ProcessEnv = process.env): GithubWatcher {
  const token = env.GITHUB_TOKEN?.trim();
  return token && env.DEMO_FALLBACK !== "1" ? new GithubLive(token) : new GithubMock();
}
