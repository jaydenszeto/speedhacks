/**
 * `pnpm demo:web` — the Mole live product demo in one command.
 *
 *   1. Mole lab server   services/mole/src/lab/server.ts on :8788 (registry crawl, sandbox trials, record, gate)
 *   2. Frontend (Vite)   frontend on :5173, proxies /lab to the lab server
 *
 * Waits for the lab's /health before starting Vite and prints what the lab can actually do (docker sandbox,
 * registry reachability), so a missing dependency is loud here instead of confusing in the browser.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LAB_PORT = Number(process.env.LAB_PORT ?? 8788);
const VITE_PORT = Number(process.env.VITE_PORT ?? 5173);
const RESET = "\x1b[0m";
const children: ChildProcess[] = [];
let down = false;

function start(name: string, color: string, cmd: string, args: string[], cwd = root): ChildProcess {
  const label = `${color}[${name}]${RESET}`;
  const child = spawn(cmd, args, { cwd, env: { ...process.env, LAB_PORT: String(LAB_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  const pipe = (b: Buffer, out: NodeJS.WriteStream) => { for (const l of b.toString().split("\n")) if (l.trim()) out.write(`${label} ${l}\n`); };
  child.stdout?.on("data", (b) => pipe(b, process.stdout));
  child.stderr?.on("data", (b) => pipe(b, process.stderr));
  child.on("exit", (code) => { if (!down) { console.error(`${label} exited (${code}). Shutting down.`); shutdown(1); } });
  return child;
}

function shutdown(code = 0) {
  down = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function waitFor(url: string, ms = 30000): Promise<unknown> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${url}`);
}

start("lab", "\x1b[36m", process.execPath, ["--import", "tsx", "services/mole/src/lab/server.ts"]);
try {
  const h = (await waitFor(`http://127.0.0.1:${LAB_PORT}/health`)) as {
    sandbox: { docker: boolean; image: boolean; detail: string }; registry: { ok: boolean; ms: number; detail: string };
  };
  console.log(`\x1b[2m· lab up · registry ${h.registry.ok ? `reachable (${h.registry.ms}ms)` : `UNREACHABLE: ${h.registry.detail}`} · sandbox ${h.sandbox.docker ? h.sandbox.detail : "docker not running: registry trials will fail; lab cases still run"}${RESET}`);
} catch (e) {
  console.error((e as Error).message);
  shutdown(1);
}
start("web", "\x1b[33m", "pnpm", ["exec", "vite", "--port", String(VITE_PORT), "--strictPort"], resolve(root, "frontend"));
await waitFor(`http://127.0.0.1:${VITE_PORT}/lab/health`).catch(() => undefined);
console.log(`\n  Mole live demo → \x1b[1mhttp://localhost:${VITE_PORT}\x1b[0m   (press R on the page to run the demo)\n`);
