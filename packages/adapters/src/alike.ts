/**
 * Alike adapter (alike.help). Alike exposes MCP only (https://alike.network/api-general/mcp) with browser OAuth and no
 * API keys, so a headless server can't write shared context. Shared-context canaries (spec §5 #9) are therefore mocked:
 * the mock "shares" a context entry and any later appearance of its marker in egress is a trip. See tasks/todo.md.
 */
export interface SharedContextEntry { id: string; scope: string; title: string; body: string }

export interface AlikeAdapter {
  readonly mode: "mock";
  share(entry: SharedContextEntry): Promise<void>;
  list(): Promise<SharedContextEntry[]>;
}

export class AlikeMock implements AlikeAdapter {
  readonly mode = "mock" as const;
  private entries: SharedContextEntry[] = [];
  async share(entry: SharedContextEntry) { this.entries.push(entry); }
  async list() { return [...this.entries]; }
}
