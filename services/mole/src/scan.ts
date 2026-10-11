/**
 * `mole scan <mcp-server-command>` — deterministic, no LLM. Spawn the target MCP server, route its egress through
 * a logging proxy, enumerate its tools from their own schemas, call each with canary-salted arguments, and detect
 * trips two ways: the collector callback (a canary URL fetched) and egress inspection (a canary seen leaving,
 * decoding url/base64/hex). Every number reported is measured here.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startProxy, type ProxyRequest } from "./proxy.js";
import { startCollector, type CollectorHit } from "./collector.js";
import { mintKit, type CanaryKit } from "./canaries.js";
import { saltArgs } from "./salt.js";
import { countSource } from "./sourcecount.js";
import { severityFor, type Finding, type ScanResult } from "./findings.js";

export interface ScanOptions {
  command: string;
  args: string[];
  /** Per-tool call timeout (ms). */
  callTimeoutMs?: number;
  dialNumber?: string;
}

/** Scan one request (proxy entry) for canaries and turn matches into findings. */
function egressFindings(kit: CanaryKit, req: ProxyRequest, tool: string): Finding[] {
  const haystack = `${req.method} ${req.url}\n${JSON.stringify(req.headers)}\n${req.body}`;
  const matches = kit.registry.scanText(haystack, { decode: true });
  return matches.map((m) => ({
    severity: severityFor(m.canary.type, "egress"),
    tool, canaryId: m.canary.id, canaryType: m.canary.type, canaryLabel: m.canary.label,
    channel: "egress" as const,
    destination: req.scheme === "https" ? `${req.host} (TLS)` : (req.host || req.url),
    matched: m.matched, decoding: m.decoding,
    evidence: `${req.method} ${req.scheme === "https" ? `https://${req.host}` : req.url}\n${req.body}`.trim(),
  }));
}

function collectorFindings(kit: CanaryKit, hit: CollectorHit, tool: string): Finding[] {
  const c = kit.registry.get(hit.canaryId);
  if (!c) return [];
  return [{
    severity: severityFor(c.type, "collector"),
    tool, canaryId: c.id, canaryType: c.type, canaryLabel: c.label,
    channel: "collector" as const,
    destination: "collector (called home)",
    matched: c.value,
    evidence: `GET /t/${hit.canaryId}  (user-agent: ${hit.userAgent ?? "n/a"})`,
  }];
}

/**
 * `npx <pkg>` would route its own registry download through our sinkhole proxy and fail. If the package is already
 * installed, rewrite the target to run its bin directly with `node` — no network needed, same server.
 */
function normalizeTarget(command: string, args: string[]): { command: string; args: string[] } {
  if (command !== "npx" && command !== "bunx") return { command, args };
  const rest = args.filter((a) => a !== "-y" && a !== "--yes" && a !== "--");
  const pkg = rest[0];
  if (!pkg) return { command, args };
  try {
    const req = createRequire(join(process.cwd(), "noop.js"));
    const pjPath = req.resolve(`${pkg}/package.json`);
    const pj = JSON.parse(readFileSync(pjPath, "utf8")) as { bin?: string | Record<string, string> };
    const dir = dirname(pjPath);
    const binRel = typeof pj.bin === "string" ? pj.bin : pj.bin?.[pkg.split("/").pop()!] ?? (pj.bin && Object.values(pj.bin)[0]);
    if (binRel) return { command: "node", args: [join(dir, binRel), ...rest.slice(1)] };
  } catch { /* not installed locally — fall through to real npx */ }
  return { command, args };
}

export async function scan(opts: ScanOptions): Promise<ScanResult> {
  const started = Date.now();
  const target = [opts.command, ...opts.args].join(" ");
  const spawnTarget = normalizeTarget(opts.command, opts.args);
  const source = countSource(spawnTarget.command, spawnTarget.args);

  const proxy = await startProxy();
  const collector = await startCollector();
  const kit = mintKit(collector.baseUrl, opts.dialNumber);

  const findings: Finding[] = [];
  const seen = new Set<string>();
  const pushUnique = (fs: Finding[]) => {
    for (const f of fs) {
      const key = `${f.canaryId}:${f.channel}:${f.destination}`;
      if (!seen.has(key)) { seen.add(key); findings.push(f); }
    }
  };

  let toolNames: string[] = [];
  let probes = 0;
  let error: string | undefined;

  const client = new Client({ name: "mole", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: spawnTarget.command,
    args: spawnTarget.args,
    // Route the server's HTTP(S) egress through our proxy; keep its inherited PATH etc. so it can actually run.
    env: {
      ...getDefaultEnvironment(),
      HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
      HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
      http_proxy: `http://127.0.0.1:${proxy.port}`,
      https_proxy: `http://127.0.0.1:${proxy.port}`,
      NO_PROXY: "",
      MOLE_COLLECTOR: collector.baseUrl,
    },
    stderr: "ignore",
  });

  const withTimeout = <T>(p: Promise<T>, ms: number, msg: string): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms).unref())]);

  try {
    await withTimeout(client.connect(transport), 15000, "server did not start (connection timed out)");
    const { tools } = await withTimeout(client.listTools(), 15000, "server did not list tools in time");
    toolNames = tools.map((t) => t.name);
    if (tools.length === 0) throw new Error("server exposed no tools to probe");

    for (const tool of tools) {
      const args = saltArgs(tool.inputSchema, kit);
      const beforeProxy = proxy.requests.length;
      const beforeHits = collector.hits.length;
      try {
        await client.callTool({ name: tool.name, arguments: args }, undefined, { timeout: opts.callTimeoutMs ?? 8000 });
      } catch { /* a tool erroring on canary input is expected and not itself a trip */ }
      probes++;
      // Give async egress (fire-and-forget fetches) a moment to reach the proxy/collector.
      await new Promise((r) => setTimeout(r, 150));
      for (const req of proxy.requests.slice(beforeProxy)) pushUnique(egressFindings(kit, req, tool.name));
      for (const hit of collector.hits.slice(beforeHits)) pushUnique(collectorFindings(kit, hit, tool.name));
    }
  } catch (e) {
    error = (e as Error).message;
  } finally {
    await client.close().catch(() => undefined);
    // Final sweep for any late egress not yet attributed to a specific tool.
    for (const req of proxy.requests) pushUnique(egressFindings(kit, req, "(post-call)"));
    for (const hit of collector.hits) pushUnique(collectorFindings(kit, hit, "(post-call)"));
    await proxy.close();
    await collector.close();
  }

  return { target, toolsFound: toolNames.length, toolNames, probes, findings, source, durationMs: Date.now() - started, error };
}
