/**
 * `mole run` acts inside a Sparta world. If a worlds server is already reachable at WORLDS_URL we use it; otherwise
 * we start one as a subprocess (auth off, so no token juggling) and tear it down when the run ends. In DEMO_FALLBACK
 * mode Sparta is mocked and this is a no-op.
 */
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

export interface SpartaHandle {
  started: boolean;
  url: string;
  stop(): Promise<void>;
}

function reachable(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok: boolean) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

export async function ensureSparta(url: string, demo: boolean): Promise<SpartaHandle> {
  if (demo) return { started: false, url, stop: async () => undefined };
  const u = new URL(url);
  const host = u.hostname;
  const port = Number(u.port || 4242);

  if (await reachable(host, port)) return { started: false, url, stop: async () => undefined };

  const req = createRequire(join(process.cwd(), "noop.js"));
  let bin: string;
  try { bin = req.resolve("sparta_worlds/bin/worlds.js"); }
  catch { throw new Error(`Sparta is not reachable at ${url} and sparta_worlds is not installed to auto-start it.`); }

  const child: ChildProcess = spawn("node", [bin, "serve", "-p", String(port), "--host", host, "--auth", "off"], {
    stdio: "ignore",
    env: process.env,
  });

  for (let i = 0; i < 60; i++) {
    if (await reachable(host, port)) {
      return { started: true, url, stop: () => new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 1500).unref(); }) };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill("SIGKILL");
  throw new Error(`Started a worlds server but it did not become reachable on :${port}.`);
}
