/**
 * `mole doctor` — preflight the environment before a real scan, run, or recording. One line per dependency with a
 * pass / warn / fail verdict: the local collector + sinkhole proxy (used by `mole scan`), Dial credentials + a masked
 * OWNER_PHONE, Keewano, the Claude CLI login (`mole run` drives the agent through it), and Sparta. Warnings never fail
 * the command — only a hard fail (a broken dependency a command actually needs) returns a non-zero exit code. Nothing
 * here is faked: Dial/Keewano/Sparta verdicts come from the same live health checks the adapters use, and the Claude
 * check sends one real haiku ping through the exact CLI-login path `mole run` uses.
 */
import { execFile } from "node:child_process";
import { buildAdapters } from "@tripwire/adapters";
import { startCollector } from "./collector.js";
import { startProxy } from "./proxy.js";
import { col, maskPhone } from "./format.js";
import { isReplay } from "./demo.js";

type Status = "pass" | "warn" | "fail";
interface Check { name: string; status: Status; detail: string }

function mark(s: Status): string {
  if (s === "pass") return col.green("✓ pass");
  if (s === "warn") return col.yellow("⚠ warn");
  return col.red("✗ fail");
}
function line(c: Check): string {
  return `  ${mark(c.status)}  ${c.name.padEnd(16)} ${col.dim(c.detail)}`;
}
function firstLine(msg: string): string {
  const l = (msg || "unknown error").split("\n")[0]!.trim();
  return l.length > 120 ? `${l.slice(0, 120)}…` : l;
}
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms / 1000}s`)), ms).unref()),
  ]);
}

async function checkCollector(): Promise<Check> {
  try {
    const c = await startCollector();
    try {
      const res = await fetch(`${c.baseUrl}/t/doctor-selftest`, { signal: AbortSignal.timeout(2000) });
      const recorded = c.hits.some((h) => h.canaryId === "doctor-selftest");
      return res.ok && recorded
        ? { name: "collector", status: "pass", detail: `callback listener bound on :${c.port}, GET /t/:id → ${res.status}` }
        : { name: "collector", status: "fail", detail: `bound on :${c.port} but self-test callback was not recorded` };
    } finally {
      await c.close();
    }
  } catch (e) {
    return { name: "collector", status: "fail", detail: `could not start: ${firstLine((e as Error).message)}` };
  }
}

async function checkProxy(): Promise<Check> {
  try {
    const p = await startProxy();
    const port = p.port;
    await p.close();
    return { name: "proxy", status: "pass", detail: `egress sinkhole bound on :${port} (captures outbound, never forwards)` };
  } catch (e) {
    return { name: "proxy", status: "fail", detail: `could not start: ${firstLine((e as Error).message)}` };
  }
}

async function checkDial(probe: ReturnType<typeof buildAdapters>): Promise<Check> {
  const owner = probe.config.ownerPhone;
  let status: Status;
  let detail: string;
  if (probe.dial.mode === "mock") {
    status = "warn";
    detail = "mock call fallback — set DIAL_API_KEY + DIAL_FROM_NUMBER for live owner alerts";
  } else {
    const h = await probe.dial.health().catch((e: Error) => ({ ok: false, detail: firstLine(e.message) }));
    status = h.ok ? "pass" : "fail";
    detail = h.detail;
  }
  if (!owner) {
    if (status === "pass") status = "warn";
    detail += " · OWNER_PHONE not set (owner alert will be skipped)";
  } else {
    detail += ` · owner ${maskPhone(owner)}`;
  }
  return { name: "Dial", status, detail };
}

async function checkKeewano(probe: ReturnType<typeof buildAdapters>): Promise<Check> {
  const h = await probe.keewano.health().catch((e: Error) => ({ ok: false, detail: firstLine(e.message) }));
  if (probe.keewano.mode === "mock") {
    return { name: "Keewano", status: "warn", detail: "local mirror only — set KEEWANO_API_KEY for live fleet intel" };
  }
  return { name: "Keewano", status: h.ok ? "pass" : "fail", detail: h.detail };
}

async function checkSparta(probe: ReturnType<typeof buildAdapters>): Promise<Check> {
  const h = await probe.sparta.health().catch((e: Error) => ({ ok: false, detail: firstLine(e.message) }));
  if (h.ok) return { name: "Sparta", status: "pass", detail: h.detail };
  return { name: "Sparta", status: "warn", detail: `not running — mole run/hire will auto-start it at ${probe.config.sparta.url}` };
}

async function checkDarwin(probe: ReturnType<typeof buildAdapters>): Promise<Check> {
  const r = await probe.darwin
    .search("agent that resolves customer support refunds")
    .catch((e: Error) => ({ mode: probe.darwin.mode, query: "", matches: [], error: e.message }));
  if (r.error) return { name: "Darwin", status: "warn", detail: `agent search unavailable (${firstLine(r.error)}) — pick/hire use local candidates` };
  return { name: "Darwin", status: "pass", detail: `agent search reachable (${r.matches.length} match${r.matches.length === 1 ? "" : "es"} for a sample query)` };
}

async function checkClaude(): Promise<Check> {
  const version = await new Promise<string | null>((resolve) => {
    execFile("claude", ["--version"], { timeout: 5000 }, (err, stdout) => resolve(err ? null : firstLine(stdout)));
  });
  if (!version) {
    return { name: "Claude CLI", status: "fail", detail: "`claude` not found on PATH — needed for mole run (install it and log in)" };
  }
  const sdk = await import("@anthropic-ai/claude-agent-sdk").catch(() => null);
  if (!sdk) return { name: "Claude CLI", status: "fail", detail: `${version} present, but @anthropic-ai/claude-agent-sdk is not installed` };
  try {
    const { query } = sdk as typeof import("@anthropic-ai/claude-agent-sdk");
    const t0 = Date.now();
    // Same auth path mole run uses: CLI OAuth login, API key explicitly blanked so we test the login, not a key.
    const run = query({
      prompt: "Reply with the single word OK.",
      options: {
        model: "claude-haiku-5-5",
        tools: [],
        mcpServers: {},
        settingSources: [],
        permissionMode: "dontAsk",
        maxTurns: 1,
        env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", ANTHROPIC_API_KEY: "" },
      },
    } as Parameters<typeof query>[0]);
    let replied = false;
    await withTimeout(
      (async () => {
        for await (const msg of run) {
          const t = (msg as { type?: string }).type;
          if (t === "assistant" || t === "result") replied = true;
        }
      })(),
      30_000,
      "Claude login ping",
    );
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    return replied
      ? { name: "Claude CLI", status: "pass", detail: `logged in · ${version} · model replied in ${dt}s` }
      : { name: "Claude CLI", status: "warn", detail: `${version} present but the model returned no reply` };
  } catch (e) {
    return { name: "Claude CLI", status: "fail", detail: `not logged in: ${firstLine((e as Error).message)} — run \`claude\` once to sign in` };
  }
}

export async function doctor(): Promise<number> {
  console.log(`\n${col.bold("mole doctor")} ${col.dim("— preflight for a real scan, run, or recording")}\n`);

  if (isReplay()) {
    console.log(line({ name: "DEMO_FALLBACK", status: "warn", detail: "ON — mole will REPLAY recorded data, not execute live. Unset it for a real recording." }));
  }

  // Force live construction so doctor reports real readiness even if DEMO_FALLBACK is set in the shell.
  const probe = buildAdapters({ ...process.env, DEMO_FALLBACK: "" });

  // Fast local checks first (they print almost instantly); the Claude login ping is the one that takes a beat.
  const fast = await Promise.all([checkCollector(), checkProxy(), checkDial(probe), checkKeewano(probe), checkSparta(probe), checkDarwin(probe)]);
  for (const c of fast) console.log(line(c));

  // On a real terminal, show a live "pinging…" placeholder and overwrite it in place; when piped, skip it (no ANSI junk).
  const tty = process.stdout.isTTY;
  if (tty) process.stdout.write(`  ${col.dim("  …   ")} ${"Claude CLI".padEnd(16)} ${col.dim("sending one real haiku ping…")}`);
  const claude = await checkClaude();
  if (tty) process.stdout.write("\r\x1b[K");
  console.log(line(claude));

  const checks = [...fast, claude];
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;

  console.log("");
  if (fails) {
    console.log(`  ${col.red(col.bold(`${fails} failed`))}${warns ? `, ${col.yellow(`${warns} warning${warns === 1 ? "" : "s"}`)}` : ""}. Fix the failures above before recording.`);
  } else if (warns) {
    console.log(`  ${col.green("core checks passed")}, ${col.yellow(`${warns} warning${warns === 1 ? "" : "s"}`)}. ${col.dim("mole scan is ready; clear the warnings for the full live owner-alert demo.")}`);
  } else {
    console.log(`  ${col.green(col.bold("all checks passed"))} ${col.dim("— scan, run, and the live owner alert are all ready.")}`);
  }
  console.log("");
  return fails ? 1 : 0;
}
