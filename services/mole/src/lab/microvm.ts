/**
 * The microVM runner: trial an untrusted npm MCP server inside a Vercel Sandbox (a Firecracker microVM), for hosts
 * with no Docker, such as the hosted demo on Vercel Functions. The same steps as the Docker sandbox, one VM per trial:
 *
 *   boot     a fresh VM, network limited to registry.npmjs.org, auto-stops after VM_TIMEOUT_MS
 *   install  `npm install --ignore-scripts` (install scripts off), output streamed as log lines
 *   seal     switch the VM's network to deny-all
 *   run      microvm-runner.mjs (scan() + our observer preload) inside the VM. Every outbound attempt is logged,
 *            then fails, because nothing can leave. Events stream back over the command's stdout.
 *   stop     always, success or not
 *
 * Auth: Vercel OIDC. Automatic inside a Vercel Function; locally, `vercel env pull` writes VERCEL_OIDC_TOKEN.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanEvent } from "../scan.js";
import type { ScanResult } from "../findings.js";
import { ASSETS, OBSERVER, REPO, dataDir, prebuilt } from "./assets.js";
import { bundleOptions } from "./bundle.js";
import { binFromPackageJson, safeSpec } from "./egress.js";

export const RUNNER_ENTRY = join(REPO, "services/mole/src/lab/microvm-runner.ts");
const MARK = "@@mole ";
const VM_TIMEOUT_MS = 4 * 60_000;
const HOME = "/vercel/sandbox";

/** True when this host can start Vercel Sandbox microVMs. MOLE_MICROVM=0 turns it off. */
export function microvmAvailable(): boolean {
  if (process.env.MOLE_MICROVM === "0") return false;
  return !!(process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN || (process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID));
}

let built: Promise<Buffer> | undefined;
/** The runner as one JS file: prebuilt in the deployed function, bundled on first use in dev. */
export function runnerBundle(): Promise<Buffer> {
  built ??= (async () => {
    const pre = prebuilt(RUNNER_ENTRY);
    if (ASSETS && existsSync(pre)) return readFileSync(pre);
    const out = join(dataDir(), "microvm", "microvm-runner.mjs");
    mkdirSync(join(dataDir(), "microvm"), { recursive: true });
    const esbuild = "esbuild"; // a variable, so the function bundle doesn't try to inline esbuild
    const { build } = (await import(esbuild)) as typeof import("esbuild");
    await build({ ...bundleOptions, entryPoints: [RUNNER_ENTRY], outfile: out });
    return readFileSync(out);
  })().catch((e) => { built = undefined; throw e; });
  return built;
}

/** Split a chunked stream into whole lines. */
export function lineSplitter(onLine: (line: string) => void) {
  let buf = "";
  return {
    push(chunk: string) {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
    },
    flush() { if (buf) onLine(buf); buf = ""; },
  };
}

/** Parse one runner stdout line: an event, the final result, or nothing (plain output). */
export function parseRunnerLine(line: string): { event?: ScanEvent; result?: ScanResult } | undefined {
  if (!line.startsWith(MARK)) return undefined;
  try { return JSON.parse(line.slice(MARK.length)) as { event?: ScanEvent; result?: ScanResult }; } catch { return undefined; }
}

export interface MicrovmHooks {
  stage(stage: "install" | "run", text: string): void;
  log(line: string): void;
  event(e: ScanEvent): void;
}

/** What to trial: a published npm package, or a self-contained JS bundle (the planted cases, for the self-test). */
export type MicrovmTarget = { npm: { pkg: string; version: string } } | { bundle: { name: string; content: Buffer } };

export async function microvmScan(target: MicrovmTarget, baitEnvNames: string[], hooks: MicrovmHooks): Promise<ScanResult> {
  if ("npm" in target && !safeSpec(target.npm.pkg, target.npm.version)) throw new Error(`refusing unusual package spec ${target.npm.pkg}@${target.npm.version}`);
  const runner = await runnerBundle();
  const { Sandbox } = await import("@vercel/sandbox");

  hooks.stage("install", `booting a Vercel Sandbox microVM · network: ${"npm" in target ? "registry.npmjs.org only" : "deny-all"}`);
  const t0 = Date.now();
  const sbx = await Sandbox.create({
    runtime: "node24", timeout: VM_TIMEOUT_MS, persistent: false,
    networkPolicy: "npm" in target ? { allow: ["registry.npmjs.org"] } : "deny-all",
  });
  try {
    hooks.log(`microVM ${sbx.name} up in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    await sbx.writeFiles([
      { path: `${HOME}/mole/runner.mjs`, content: runner },
      { path: `${HOME}/mole/observe.cjs`, content: readFileSync(OBSERVER) },
      ...("bundle" in target ? [{ path: `${HOME}/pkg/${target.bundle.name}`, content: target.bundle.content }] : []),
    ]);
    const rel = "npm" in target ? await npmInstall(sbx, target.npm.pkg, target.npm.version, hooks) : target.bundle.name;

    await sbx.update({ networkPolicy: "deny-all" });
    hooks.stage("run", "microVM sealed · network deny-all · observer attached");

    const run = await sbx.runCommand({
      cmd: "node", args: [`${HOME}/mole/runner.mjs`, `${HOME}/pkg/${rel}`, `${HOME}/mole/observe.cjs`, JSON.stringify(baitEnvNames)],
      cwd: `${HOME}/pkg`, env: { HOME: "/tmp" }, detached: true,
    });
    let result: ScanResult | undefined;
    const errTail: string[] = [];
    const out = lineSplitter((l) => {
      const m = parseRunnerLine(l);
      if (m?.event) hooks.event(m.event);
      else if (m?.result) result = m.result;
    });
    const err = lineSplitter((l) => { if (l.trim()) errTail.push(l.slice(0, 200)); if (errTail.length > 5) errTail.shift(); });
    for await (const { stream, data } of run.logs()) (stream === "stdout" ? out : err).push(data);
    out.flush(); err.flush();
    const done = await run.wait();
    if (!result) throw new Error(`trial runner exited ${done.exitCode} without a result${errTail.length ? `: ${errTail.join(" | ")}` : ""}`);
    return result;
  } finally {
    await sbx.stop().catch(() => undefined);
  }
}

type VM = InstanceType<typeof import("@vercel/sandbox").Sandbox>;

/** `npm install` inside the VM, scripts off, output streamed. Returns the server's entry relative to pkg/. */
async function npmInstall(sbx: VM, pkg: string, version: string, hooks: MicrovmHooks): Promise<string> {
  hooks.stage("install", `npm install ${pkg}@${version} · scripts disabled · inside the microVM`);
  const install = await sbx.runCommand({
    cmd: "sh",
    args: ["-c", `mkdir -p pkg && cd pkg && echo '{"private":true}' > package.json && npm install --ignore-scripts --no-audit --no-fund --no-update-notifier --loglevel=error "${pkg}@${version}" && echo installed`],
    cwd: HOME, detached: true,
  });
  const lines = lineSplitter((l) => { if (l.trim()) hooks.log(l.slice(0, 200)); });
  for await (const { data } of install.logs()) lines.push(data);
  lines.flush();
  const { exitCode } = await install.wait();
  if (exitCode !== 0) throw new Error(`npm install failed (exit ${exitCode})`);
  const pj = await sbx.readFileToBuffer({ path: `${HOME}/pkg/node_modules/${pkg}/package.json` });
  const rel = pj ? binFromPackageJson(JSON.parse(pj.toString("utf8")), pkg) : undefined;
  if (!rel) throw new Error(`${pkg} has no runnable bin`);
  return rel;
}
