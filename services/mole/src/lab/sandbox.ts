/**
 * The sandbox runner: run an untrusted npm MCP server from a marketplace without trusting it.
 *
 *   install  `npm install --ignore-scripts` inside a throwaway node container (network on, install scripts off),
 *            into .mole/sandbox/pkgs/<pkg>@<version>. Cached across trials.
 *   run      a second container with NO network (--network none), dropped capabilities, memory/cpu/pid limits, the
 *            package mounted read-only, and our observer preloaded. The observer writes every outbound attempt to a
 *            per-trial egress.jsonl that Mole reads back as ProxyRequests. Nothing can leave; we see what it tried.
 *
 * The server's stdio is the only channel between it and Mole (docker run -i), which is exactly the MCP transport.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Runner } from "../scan.js";
import { countSource } from "../sourcecount.js";
import { OBSERVER, dataDir } from "./assets.js";
import { binFromPackageJson, readEgress, safeSpec } from "./egress.js";
import { microvmAvailable } from "./microvm.js";

export { readEgress };

const exec = promisify(execFile);
export const SANDBOX_IMAGE = "node:22-slim";
const ROOT = join(dataDir(), "sandbox");

/**
 * Which sandbox this host trials registry servers in: Docker when it's running (local dev), else a Vercel Sandbox
 * microVM (the hosted demo), else none. `ready` is what the UI gates registry trials on.
 */
export interface SandboxStatus { kind: "docker" | "microvm" | "none"; ready: boolean; docker: boolean; image: boolean; detail: string }

export async function dockerStatus(): Promise<{ docker: boolean; image: boolean; detail: string }> {
  if (process.env.VERCEL) return { docker: false, image: false, detail: "no docker on Vercel Functions" };
  try {
    await exec("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 8000 });
  } catch {
    return { docker: false, image: false, detail: "docker is not running" };
  }
  try {
    await exec("docker", ["image", "inspect", SANDBOX_IMAGE], { timeout: 8000 });
    return { docker: true, image: true, detail: `${SANDBOX_IMAGE} ready` };
  } catch {
    return { docker: true, image: false, detail: `${SANDBOX_IMAGE} not pulled yet` };
  }
}

export async function sandboxStatus(): Promise<SandboxStatus> {
  const d = await dockerStatus();
  if (d.docker && d.image) return { kind: "docker", ready: true, ...d };
  if (microvmAvailable()) return { kind: "microvm", ready: true, ...d, detail: "Vercel Sandbox microVM · one per trial" };
  return { kind: "none", ready: false, ...d };
}

let pulling: Promise<void> | undefined;
/** Pull the sandbox image once (in the background at lab start). */
export function ensureImage(): Promise<void> {
  pulling ??= (async () => {
    const s = await dockerStatus();
    if (!s.docker || s.image) return;
    await exec("docker", ["pull", SANDBOX_IMAGE], { timeout: 300000 });
  })().catch((e) => { pulling = undefined; throw e; });
  return pulling;
}

export interface Installed {
  pkg: string;
  version: string;
  hostDir: string;
  /** Path of the server's bin inside the container. */
  binInContainer: string;
  binOnHost: string;
}

const slug = (pkg: string, version: string) => `${pkg.replace(/[@/]/g, "_")}@${version}`;

function resolveBin(hostDir: string, pkg: string): string | undefined {
  const pjPath = join(hostDir, "node_modules", pkg, "package.json");
  return existsSync(pjPath) ? binFromPackageJson(JSON.parse(readFileSync(pjPath, "utf8")), pkg) : undefined;
}

/** Install a package inside a container (scripts disabled). Streams npm's output lines to onLog. */
export async function installPackage(pkg: string, version: string, onLog: (line: string) => void = () => undefined): Promise<Installed> {
  if (!safeSpec(pkg, version)) throw new Error(`refusing unusual package spec ${pkg}@${version}`);
  await ensureImage();
  const hostDir = join(ROOT, "pkgs", slug(pkg, version));
  let rel = resolveBin(hostDir, pkg);
  if (rel) {
    onLog(`cached ${pkg}@${version}`);
  } else {
    mkdirSync(hostDir, { recursive: true });
    await new Promise<void>((ok, fail) => {
      const child = spawn("docker", [
        "run", "--rm", "--memory", "1g", "-v", `${hostDir}:/pkg`, "-w", "/pkg", SANDBOX_IMAGE,
        "sh", "-c", `echo '{"private":true}' > package.json && npm install --ignore-scripts --no-audit --no-fund --loglevel=error "${pkg}@${version}" && echo installed`,
      ]);
      const pipe = (b: Buffer) => b.toString().split("\n").filter(Boolean).forEach((l) => onLog(l.slice(0, 200)));
      child.stdout.on("data", pipe);
      child.stderr.on("data", pipe);
      const timer = setTimeout(() => { child.kill("SIGKILL"); fail(new Error("install timed out")); }, 180000);
      child.on("exit", (code) => { clearTimeout(timer); code === 0 ? ok() : fail(new Error(`npm install failed (exit ${code})`)); });
    });
    rel = resolveBin(hostDir, pkg);
    if (!rel) throw new Error(`${pkg} has no runnable bin`);
  }
  return { pkg, version, hostDir, binInContainer: `/pkg/${rel}`, binOnHost: join(hostDir, rel) };
}

/** A Runner that executes an installed package in a locked-down, network-less container. */
export function sandboxRunner(inst: Installed, serverArgs: string[] = []): Runner {
  return async ({ baitEnv }) => {
    const runId = `mole-sbx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const runDir = join(ROOT, "runs", runId);
    mkdirSync(runDir, { recursive: true });
    const egressFile = join(runDir, "egress.jsonl");
    const envArgs = Object.entries(baitEnv).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const args = [
      "run", "--rm", "-i", "--name", runId,
      "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--memory", "512m", "--cpus", "1", "--pids-limit", "256",
      "--tmpfs", "/tmp", "-e", "HOME=/tmp",
      "-v", `${inst.hostDir}:/pkg:ro`, "-v", `${runDir}:/mole/out`, "-v", `${OBSERVER}:/mole/observe.cjs:ro`,
      "-e", "NODE_OPTIONS=--require=/mole/observe.cjs", "-e", "MOLE_EGRESS=/mole/out/egress.jsonl",
      ...envArgs, "-w", "/pkg", SANDBOX_IMAGE, "node", inst.binInContainer, ...serverArgs,
    ];
    return {
      name: "sandbox",
      command: "docker",
      args,
      env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp" },
      requests: () => readEgress(egressFile),
      source: countSource("node", [inst.binOnHost]),
      close: async () => {
        await exec("docker", ["rm", "-f", runId], { timeout: 10000 }).catch(() => undefined);
        rmSync(runDir, { recursive: true, force: true });
      },
    };
  };
}
