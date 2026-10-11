/**
 * Mole CLI entrypoint. "Mole: we catch bad AI agents red-handed."
 * The trust layer for AI agents hiring other AI agents.
 *   mole hire "<task>"               a personal assistant hires a specialist — Mole clears it first (the demo flow)
 *   mole pick "<task>"               trial every candidate agent and rank them: cleared, or caught
 *   mole scan <mcp-server-command>   probe one server's tools with bait (deterministic, no LLM)
 *   mole run                         run the known-bad agent and catch it live
 *   mole report                      render the Trust Report from the last hire, pick, scan, or run
 *   mole doctor                      preflight check the environment
 */
import { scan } from "./scan.js";
import { run } from "./run.js";
import { report } from "./report.js";
import { doctor } from "./doctor.js";
import { pick, renderPick } from "./pick.js";
import { hire, DEFAULT_HIRE_TASK } from "./hire.js";
import { renderScan, col } from "./format.js";
import { saveLastScan, saveLastPick, saveLastHire } from "./state.js";
import { replayBannerIfEnabled, isReplay } from "./demo.js";

function splitTarget(rest: string[]): { flags: string[]; command?: string; args: string[] } {
  const flags: string[] = [];
  let i = 0;
  // Leading mole flags, then an optional `--` separator, then the target command + its args.
  while (i < rest.length && rest[i]!.startsWith("-") && rest[i] !== "--") { flags.push(rest[i]!); i++; }
  if (rest[i] === "--") i++;
  const [command, ...args] = rest.slice(i);
  return { flags, command, args };
}

async function cmdRun(rest: string[]): Promise<number> {
  // Default (and supported) target is the built-in Compromised agent. An external `-- <command>` wrapper is noted,
  // not faked: this build drives the built-in live agent.
  const after = rest.includes("--") ? rest.slice(rest.indexOf("--") + 1) : rest.filter((a) => !a.startsWith("-"));
  if (after.length) console.error(col.dim(`note: mole run drives the built-in Compromised agent; external agent wrapping isn't in this build. Ignoring: ${after.join(" ")}\n`));
  const record = await run();
  return record.trips.length > 0 ? 1 : 0;
}

async function cmdScan(rest: string[]): Promise<number> {
  const { flags, command, args } = splitTarget(rest);
  const json = flags.includes("--json");
  if (!command) {
    console.error(`usage: ${col.bold("mole scan")} [--json] <mcp-server-command> [args...]`);
    console.error(`e.g.   mole scan npx -y @modelcontextprotocol/server-filesystem /tmp`);
    return 2;
  }
  replayBannerIfEnabled();
  const result = await scan({ command, args, dialNumber: (process.env.DIAL_CANARY_NUMBERS ?? "").split(",")[0]?.trim() || undefined });
  saveLastScan(result);
  if (json) console.log(JSON.stringify(result, null, 2));
  else process.stdout.write(renderScan(result));
  // A scan that couldn't run (server didn't start / no tools) is a failure (2), never a clean pass (0).
  if (result.error || result.toolsFound === 0) return 2;
  return result.findings.length > 0 ? 1 : 0;
}

async function cmdPick(rest: string[]): Promise<number> {
  const json = rest.includes("--json");
  const sequential = rest.includes("--sequential");
  const task = rest.filter((a) => !a.startsWith("-")).join(" ").trim();
  if (!task) {
    console.error(`usage: ${col.bold("mole pick")} [--json] [--sequential] "<task>"`);
    console.error(`e.g.   mole pick "resolve the customer refund queue"`);
    return 2;
  }
  // For --json, keep stdout clean (JSON only): the REPLAY banner, header, and progress all go to stderr.
  if (json) { if (isReplay()) console.error("REPLAY: DEMO_FALLBACK is on — output is mocked, not a live run."); }
  else { replayBannerIfEnabled(); console.log(`\n${col.bold("mole pick")} ${col.dim("—")} ${task}`); }
  const onStage = json ? (l: string) => console.error(l) : (l: string) => console.log(l);
  const result = await pick(task, { sequential, onStage });
  saveLastPick(result);
  if (json) console.log(JSON.stringify(result, null, 2));
  else process.stdout.write(`\n${renderPick(result)}`);
  // Exit 0 when at least one agent is safe to hire, 1 when none cleared.
  return result.clearedLabels.length > 0 ? 0 : 1;
}

async function cmdHire(rest: string[]): Promise<number> {
  const sequential = rest.includes("--sequential");
  const task = rest.filter((a) => !a.startsWith("-")).join(" ").trim() || DEFAULT_HIRE_TASK;
  const result = await hire(task, { sequential });
  saveLastHire(result);
  return result.delegate ? 0 : 1;
}

async function cmdReport(rest: string[]): Promise<number> {
  const out = rest.find((a) => !a.startsWith("-"));
  const res = await report(out);
  if ("error" in res) { console.error(res.error); return 2; }
  console.log(`${col.bold("Trust Report")} written to ${col.cyan(res.path)}`);
  console.log(col.dim(`open it: open ${res.path}`));
  return 0;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "scan": return cmdScan(rest);
    case "pick": return cmdPick(rest);
    case "hire": return cmdHire(rest);
    case "run": return cmdRun(rest);
    case "report": return cmdReport(rest);
    case "doctor": return doctor();
    case undefined:
    case "-h":
    case "--help":
      console.log(`${col.bold("mole")} — we catch bad AI agents red-handed\n`);
      console.log(`  mole hire "<task>"               an assistant hires a specialist; Mole clears it first (the demo)`);
      console.log(`  mole pick "<task>"               trial every candidate agent and rank them: cleared, or caught`);
      console.log(`  mole scan <mcp-server-command>   probe one server's tools with bait (deterministic, no LLM)`);
      console.log(`  mole run                         run the known-bad agent and catch it live`);
      console.log(`  mole report                      render the Trust Report from the last hire, pick, scan, or run`);
      console.log(`  mole doctor                      preflight check the environment`);
      return 0;
    default:
      console.error(`unknown command: ${cmd}`);
      return 2;
  }
}

main().then((code) => { process.exitCode = code; }).catch((e) => { console.error(e); process.exitCode = 1; });
