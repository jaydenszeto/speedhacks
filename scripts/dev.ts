/**
 * One command to run Tripwire end to end: `pnpm dev` (live sponsors) or `pnpm demo` (DEMO_FALLBACK=1, no keys).
 *
 * Starts, with prefixed + colored logs and a clean shutdown on Ctrl-C:
 *   1. Sparta Worlds server   `worlds serve` on :4242   — skipped in demo mode (SpartaMock is used instead)
 *   2. Tripwire API gateway   services/api on :8787      — collector, webhooks, SSE, orchestrator, scoring
 *   3. Frontend (Vite)        frontend on :5173          — proxies /api, /t, /webhooks, /health to the API
 *
 * Every service exposes /health; this script waits for each to answer before starting the next, so a failed
 * dependency is reported loudly instead of surfacing as a confusing error in the browser.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Load .env if present (Node 24 built-in; no dotenv dependency).
const envFile = resolve(root, ".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
  console.log(`\x1b[2m· loaded .env\x1b[0m`);
}

const demo = ["1", "true", "yes"].includes((process.env.DEMO_FALLBACK ?? "").toLowerCase());
const SPARTA_PORT = Number(process.env.WORLDS_PORT ?? 4242);
const API_PORT = Number(process.env.PORT ?? 8787);
const VITE_PORT = Number(process.env.VITE_PORT ?? 5173);

const COLORS = ["\x1b[36m", "\x1b[33m", "\x1b[35m"]; // cyan, yellow, magenta
const RESET = "\x1b[0m";
const children: ChildProcess[] = [];
let shuttingDown = false;

interface Svc {
  name: string;
  cmd: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  health?: string; // URL to poll before considering it up
}

function run(svc: Svc, color: string): ChildProcess {
  const label = `${color}[${svc.name}]${RESET}`;
  const child = spawn(svc.cmd, svc.args, {
    cwd: svc.cwd ?? root,
    env: { ...process.env, ...svc.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const pipe = (buf: Buffer, stream: NodeJS.WriteStream) => {
    for (const line of buf.toString().split("\n")) if (line.trim()) stream.write(`${label} ${line}\n`);
  };
  child.stdout?.on("data", (b) => pipe(b, process.stdout));
  child.stderr?.on("data", (b) => pipe(b, process.stderr));
  child.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`${label} exited with code ${code}. Shutting everything down.`);
    shutdown(code ?? 1);
  });
  return child;
}

async function waitForHealth(url: string, name: string, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${name} did not become healthy at ${url} within ${(tries * 0.5) | 0}s`);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n\x1b[2m· stopping services…\x1b[0m");
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => {
    for (const c of children) if (!c.killed) c.kill("SIGKILL");
    process.exit(code);
  }, 1500).unref();
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  console.log(`\n\x1b[1mTripwire\x1b[0m — ${demo ? "\x1b[35mdemo mode\x1b[0m (mocked sponsors, no keys)" : "live mode"}\n`);

  let colorIdx = 0;
  const next = () => COLORS[colorIdx++ % COLORS.length]!;

  // 1. Sparta Worlds — only when we actually talk to it (live mode).
  if (!demo) {
    run(
      { name: "sparta", cmd: "node", args: ["node_modules/sparta_worlds/bin/worlds.js", "serve", "-p", String(SPARTA_PORT)] },
      next(),
    );
    try {
      await waitForHealth(`http://127.0.0.1:${SPARTA_PORT}/health`, "Sparta", 40);
      console.log(`\x1b[32m✓\x1b[0m Sparta Worlds ready on :${SPARTA_PORT}`);
    } catch {
      // Sparta may not expose /health on every build; give it a beat and proceed — the adapter falls back to mock if unreachable.
      console.log(`\x1b[2m· Sparta /health not confirmed; continuing (adapter falls back to mock if unreachable)\x1b[0m`);
    }
  }

  // 2. API gateway.
  run({ name: "api", cmd: "npx", args: ["tsx", "services/api/src/server.ts"], env: { PORT: String(API_PORT) } }, next());
  await waitForHealth(`http://127.0.0.1:${API_PORT}/health`, "API");
  console.log(`\x1b[32m✓\x1b[0m API gateway ready on :${API_PORT}`);

  // 3. Frontend. Vite binds `localhost`; probe that name (Node resolves IPv4/IPv6) rather than 127.0.0.1.
  run({ name: "web", cmd: "pnpm", args: ["-C", "frontend", "dev", "--port", String(VITE_PORT)] }, next());
  await waitForHealth(`http://localhost:${VITE_PORT}/`, "Frontend");

  console.log(`\n\x1b[1m\x1b[32m  Tripwire is up\x1b[0m`);
  console.log(`  \x1b[1mDashboard\x1b[0m   http://localhost:${VITE_PORT}`);
  console.log(`  API         http://localhost:${API_PORT}/health`);
  console.log(`  \x1b[2mCtrl-C to stop everything\x1b[0m\n`);
}

main().catch((e) => {
  console.error(`\x1b[31m✗ startup failed:\x1b[0m ${(e as Error).message}`);
  shutdown(1);
});
