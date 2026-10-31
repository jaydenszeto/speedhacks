/**
 * `mole scan <mcp-server-command>`: deterministic, no LLM. Spawn the target MCP server, route its egress through
 * a logging proxy, enumerate its tools from their own schemas, call each with canary-salted arguments, and detect
 * trips two ways: the collector callback (a canary URL fetched) and egress inspection (a canary seen leaving,
 * decoding url/base64/hex). Every number reported is measured here.
 *
 * The server's credentials are bait too: STRIPE_SECRET_KEY / DATABASE_URL (and, for sandboxed registry servers,
 * every env var the listing marks as required) are set to canary values, so a server that reads its environment
 * and ships it somewhere is caught the same way.
 *
 * Two runners share this loop:
 *   local    (default) spawn on this machine, egress via our sinkhole proxy (HTTP_PROXY). Used for our fixtures.
 *   sandbox  supplied by the lab: a docker container with no network, egress observed by a runtime preload.
 * `onEvent` streams every step (bait planted, tools listed, each probe, each outbound attempt, each finding) so a
 * UI can show the trial as it happens.
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
import { countSource, type SourceCount } from "./sourcecount.js";
import { severityFor, type Finding, type ScanResult } from "./findings.js";
import { redactSecrets, redactSecretValue } from "./format.js";

/** What a runner hands back: how to spawn the server, and how to read what it tried to send out. */
export interface RunnerHandle {
  name: "local" | "sandbox";
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Every outbound attempt observed so far (append-only). */
  requests(): ProxyRequest[];
  /** Source size, when the runner knows where the code lives. */
  source?: SourceCount;
  close(): Promise<void>;
}

export interface RunnerContext {
  kit: CanaryKit;
  /** Env vars set to bait (credential-shaped canaries). */
  baitEnv: Record<string, string>;
  collectorBase: string;
}

export type Runner = (ctx: RunnerContext) => Promise<RunnerHandle>;

/** Live trial events. All secret values are redacted before they leave this module. */
export type ScanEvent =
  | { type: "bait"; items: { id: string; label: string; kind: string; preview: string; where: string }[] }
  | { type: "spawn"; runner: RunnerHandle["name"]; command: string }
  | { type: "source"; files: number; lines: number }
  | { type: "connected"; ms: number }
  | { type: "tools"; names: string[]; descriptions: Record<string, string> }
  | { type: "probe"; tool: string; args: string }
  | { type: "probe-done"; tool: string; ms: number; outcome: "ok" | "error" }
  | { type: "egress"; tool: string; method: string; scheme: string; host: string; target: string; bytes: number; bait: boolean; own?: boolean }
  | { type: "finding"; finding: Finding & { expected?: boolean } }
  | { type: "error"; message: string }
  | { type: "done"; result: ScanResult };

export interface ScanOptions {
  command: string;
  args: string[];
  /** Per-tool call timeout (ms). */
  callTimeoutMs?: number;
  dialNumber?: string;
  /** Defaults to the local proxy runner. */
  runner?: Runner;
  /** Extra env vars to fill with credential bait (e.g. a registry listing's required keys). */
  baitEnvNames?: string[];
  onEvent?: (e: ScanEvent) => void;
}

/** Scan one request (proxy entry) for canaries and turn matches into findings. */
export function egressFindings(kit: Pick<CanaryKit, "registry">, req: ProxyRequest, tool: string): Finding[] {
  const haystack = `${req.method} ${req.url}\n${JSON.stringify(req.headers)}\n${req.body}`;
  const matches = kit.registry.scanText(haystack, { decode: true });
  return matches.map((m) => ({
    severity: severityFor(m.canary.type, "egress"),
    tool, canaryId: m.canary.id, canaryType: m.canary.type, canaryLabel: m.canary.label,
    channel: "egress" as const,
    destination: req.scheme === "https" && !req.body ? `${req.host} (TLS)` : (req.host || req.url),
    matched: m.matched, decoding: m.decoding,
    evidence: `${req.method} ${req.scheme === "https" && !req.url.startsWith("https://") ? `https://${req.host}` : req.url}\n${req.body}`.trim(),
  }));
}

export function collectorFindings(kit: CanaryKit, hit: CollectorHit, tool: string): Finding[] {
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
 * installed, rewrite the target to run its bin directly with `node`: no network needed, same server.
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
  } catch { /* not installed locally: fall through to real npx */ }
  return { command, args };
}

/** The default runner: spawn locally, egress through the sinkhole proxy. */
/** `sourceArgs` overrides what the source count reads (e.g. the TypeScript source when a prebuilt bundle runs). */
export function localRunner(command: string, args: string[], extraEnv: Record<string, string> = {}, sourceArgs?: string[]): Runner {
  return async ({ baitEnv, collectorBase }) => {
    const target = normalizeTarget(command, args);
    const proxy = await startProxy();
    const p = `http://127.0.0.1:${proxy.port}`;
    return {
      name: "local",
      command: target.command,
      args: target.args,
      env: {
        ...getDefaultEnvironment(),
        ...extraEnv,
        ...baitEnv,
        HTTP_PROXY: p, HTTPS_PROXY: p, http_proxy: p, https_proxy: p, NO_PROXY: "",
        MOLE_COLLECTOR: collectorBase,
      },
      requests: () => proxy.requests,
      source: sourceArgs ? countSource("node", sourceArgs) : countSource(target.command, target.args),
      close: () => proxy.close(),
    };
  };
}

/** Credential-shaped bait for the server's environment. */
function baitEnvFor(kit: CanaryKit, extraNames: string[] = []): Record<string, string> {
  const secret = kit.byRole("secret")!.value;
  const env: Record<string, string> = { STRIPE_SECRET_KEY: secret, DATABASE_URL: kit.byRole("db")!.value };
  for (const name of extraNames) {
    if (env[name]) continue;
    env[name] = /url|uri|dsn|host|endpoint/i.test(name) ? kit.byRole("db")!.value : secret;
  }
  return env;
}

/** Short, redacted preview of a bait value for display. */
function baitPreview(kind: string, value: string): string {
  if (kind === "email") return value.replace(/^(.{3}).*(@.*)$/, "$1•••$2");
  if (kind === "phone") return `•••• ${value.slice(-2)}`;
  if (kind === "url") return value.replace(/\/t\/.*$/, "/t/••••");
  return redactSecretValue(value);
}

export async function scan(opts: ScanOptions): Promise<ScanResult> {
  const started = Date.now();
  const emit = opts.onEvent ?? (() => undefined);
  const target = [opts.command, ...opts.args].join(" ");

  const collector = await startCollector();
  const kit = mintKit(collector.baseUrl, opts.dialNumber);
  const baitEnv = baitEnvFor(kit, opts.baitEnvNames);
  const known = kit.canaries.map((c) => c.value);
  const redact = (s: string) => redactSecrets(s, known);

  emit({
    type: "bait",
    items: [
      ...kit.canaries.map((c) => ({ id: c.id, label: c.label, kind: c.role, preview: baitPreview(c.role, c.value), where: "tool arguments" })),
      ...Object.entries(baitEnv).map(([name, v]) => ({
        id: `env:${name}`, label: name, kind: "env", preview: redactSecretValue(v), where: "server environment",
      })),
    ],
  });

  const runner = await (opts.runner ?? localRunner(opts.command, opts.args))({ kit, baitEnv, collectorBase: collector.baseUrl });
  const source = runner.source ?? { files: 0, lines: 0 } as SourceCount;
  emit({ type: "spawn", runner: runner.name, command: redact([runner.command, ...runner.args].join(" ")) });
  if (source.files) emit({ type: "source", files: source.files, lines: source.lines });

  const findings: Finding[] = [];
  const seen = new Set<string>();
  const pushUnique = (fs: Finding[]) => {
    for (const f of fs) {
      const key = `${f.canaryId}:${f.channel}:${f.destination}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(f);
      emit({ type: "finding", finding: { ...f, matched: f.matched ? redactSecretValue(f.matched) : f.matched, evidence: redact(f.evidence) } });
    }
  };

  let reqCursor = 0;
  let hitCursor = 0;
  /** Attribute every new outbound attempt / callback since the last sweep to `tool`. */
  const sweep = (tool: string) => {
    const reqs = runner.requests();
    for (const req of reqs.slice(reqCursor)) {
      const fs = egressFindings(kit, req, tool);
      emit({
        type: "egress", tool, method: req.method, scheme: req.scheme, host: req.host || "(unknown)",
        target: redact(req.url).slice(0, 160), bytes: Buffer.byteLength(req.body ?? ""), bait: fs.length > 0,
      });
      pushUnique(fs);
    }
    reqCursor = reqs.length;
    for (const hit of collector.hits.slice(hitCursor)) pushUnique(collectorFindings(kit, hit, tool));
    hitCursor = collector.hits.length;
  };

  let toolNames: string[] = [];
  let probes = 0;
  let error: string | undefined;

  const client = new Client({ name: "mole", version: "0.1.0" });
  const transport = new StdioClientTransport({ command: runner.command, args: runner.args, env: runner.env, stderr: "ignore" });

  const withTimeout = <T>(p: Promise<T>, ms: number, msg: string): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms).unref())]);

  try {
    const t0 = Date.now();
    await withTimeout(client.connect(transport), runner.name === "sandbox" ? 30000 : 15000, "server did not start (connection timed out)");
    emit({ type: "connected", ms: Date.now() - t0 });
    const { tools } = await withTimeout(client.listTools(), 15000, "server did not list tools in time");
    toolNames = tools.map((t) => t.name);
    emit({ type: "tools", names: toolNames, descriptions: Object.fromEntries(tools.map((t) => [t.name, (t.description ?? "").slice(0, 160)])) });
    if (tools.length === 0) throw new Error("server exposed no tools to probe");

    for (const tool of tools) {
      const args = saltArgs(tool.inputSchema, kit);
      emit({ type: "probe", tool: tool.name, args: redact(JSON.stringify(args)).slice(0, 240) });
      const p0 = Date.now();
      let outcome: "ok" | "error" = "ok";
      try {
        const res = await client.callTool({ name: tool.name, arguments: args }, undefined, { timeout: opts.callTimeoutMs ?? 8000 });
        if ((res as { isError?: boolean }).isError) outcome = "error";
      } catch { outcome = "error"; /* a tool erroring on canary input is expected and not itself a trip */ }
      probes++;
      // Give async egress (fire-and-forget fetches) a moment to reach the proxy/collector.
      await new Promise((r) => setTimeout(r, runner.name === "sandbox" ? 300 : 150));
      sweep(tool.name);
      emit({ type: "probe-done", tool: tool.name, ms: Date.now() - p0, outcome });
    }
  } catch (e) {
    error = (e as Error).message;
    emit({ type: "error", message: error });
  } finally {
    await client.close().catch(() => undefined);
    // Final sweep for any late egress not yet attributed to a specific tool.
    await new Promise((r) => setTimeout(r, runner.name === "sandbox" ? 300 : 0));
    sweep("(post-call)");
    await runner.close().catch(() => undefined);
    await collector.close();
  }

  const result: ScanResult = { target, toolsFound: toolNames.length, toolNames, probes, findings, source, durationMs: Date.now() - started, error };
  emit({ type: "done", result: { ...result, findings: result.findings.map((f) => ({ ...f, matched: f.matched ? redactSecretValue(f.matched) : f.matched, evidence: redact(f.evidence) })) } });
  return result;
}
