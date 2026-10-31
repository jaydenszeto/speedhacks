/**
 * Mole CLI entrypoint. "Mole: give an AI agent your credit card and walk away."
 * The trust layer for AI agents hiring other AI agents.
 *   mole hire "<task>"               a personal assistant hires a specialist — Mole clears it first (the demo flow)
 *   mole pick "<task>"               trial every candidate agent and rank them: cleared, or caught
 *   mole scan <mcp-server-command>   probe one server's tools with bait (deterministic, no LLM)
 *   mole run                         run the known-bad agent and catch it live
 *   mole report                      render the Trust Report from the last hire, pick, scan, or run
 *   mole doctor                      preflight check the environment
 *   mole identities mint|list|check  planted identities: which vendor leaked or sold your data?
 *   mole bom <manifest>              behavioral bill of materials against the local record (.mole/record.json)
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
import { readFileSync } from "node:fs";
import { IdentityLedger, maskIdentity } from "./lab/identities.js";
import { behavioralBom } from "./lab/products.js";
import { RecordStore } from "./lab/record.js";

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
  // Exit 0 when at least one agent is cleared to hire, 1 when none cleared.
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

function readInput(path: string | undefined): string | null {
  if (!path) return null;
  return readFileSync(path === "-" ? 0 : path, "utf8");
}

async function cmdIdentities(rest: string[]): Promise<number> {
  const [sub, ...args] = rest;
  const ledger = new IdentityLedger();
  const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (sub === "mint") {
    const vendor = args.find((a, i) => !a.startsWith("-") && !["--purpose", "--domain", "--phone"].includes(args[i - 1] ?? ""));
    if (!vendor) { console.error(`usage: ${col.bold("mole identities mint")} <vendor> [--purpose "<what you'll use it for>"] [--domain <mail domain you control>] [--phone <number you control>]`); return 2; }
    const i = ledger.mint(vendor, flag("--purpose") ?? "signup", { domain: flag("--domain"), phone: flag("--phone") });
    // The person you hand over is printed in full exactly once, here, so you can use it. The ledger keeps it.
    console.log(`${col.bold("identity for")} ${vendor} ${col.dim(`(${i.id})`)}
`);
    console.log(`  name     ${i.first} ${i.last}
  email    ${i.email}
  phone    ${i.phone}
  address  ${i.address}
  phrase   ${i.phrase}
`);
    console.log(col.dim("Hand this to that vendor only. Later: mole identities check <file> on any spam, dump, list, or model output."));
    if (!flag("--domain") && !process.env.MOLE_IDENTITY_DOMAIN) console.log(col.dim("Using mole-canary.example (reserved, can't receive mail). Set --domain or MOLE_IDENTITY_DOMAIN to a domain you control."));
    return 0;
  }
  if (sub === "list") {
    const all = ledger.all().map(maskIdentity);
    if (!all.length) { console.log(col.dim("No identities yet. mole identities mint <vendor>")); return 0; }
    for (const i of all) console.log(`${i.id}  ${i.vendor.padEnd(22)} ${i.email.padEnd(34)} ${i.phone}  ${col.dim(i.issuedAt.slice(0, 10))}`);
    return 0;
  }
  if (sub === "check") {
    const text = readInput(args[0]);
    if (text === null) { console.error(`usage: ${col.bold("mole identities check")} <file | ->`); return 2; }
    const sightings = ledger.check(text, args[0] === "-" ? "stdin" : args[0]!);
    if (!sightings.length) { console.log(`No ledger identities found in ${args[0]}. ${col.dim("(Absence isn't proof a vendor is clean.)")}`); return 0; }
    for (const s of sightings) console.log(`${col.red(col.bold("SIGHTING"))}  identity ${s.identityId} was given only to ${col.bold(s.vendor)} · matched ${s.fields.join(", ")}`);
    return 1;
  }
  console.error(`usage: mole identities <mint|list|check>`);
  return 2;
}

async function cmdBom(rest: string[]): Promise<number> {
  const json = rest.includes("--json");
  const text = readInput(rest.find((a) => !a.startsWith("--")));
  if (text === null) { console.error(`usage: ${col.bold("mole bom")} [--json] <package.json | .mcp.json | list.txt | ->`); return 2; }
  const bom = behavioralBom(text, new RecordStore());
  if (json) { console.log(JSON.stringify(bom, null, 2)); }
  else {
    for (const c of bom.components) {
      const tag = c.status === "caught" ? col.red(col.bold("CAUGHT   ")) : c.status === "cleared" ? col.bold("cleared  ") : col.dim(c.status.padEnd(9));
      console.log(`${tag} ${c.ref}  ${col.dim(c.summary ?? "")}`);
    }
    const s = bom.summary;
    console.log(`
${s.components} components · ${s.cleared} cleared · ${s.caught} caught · ${s.overreach} overreach · ${s.untested} untested`);
  }
  return bom.summary.caught > 0 ? 1 : 0;
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
    case "identities": return cmdIdentities(rest);
    case "bom": return cmdBom(rest);
    case undefined:
    case "-h":
    case "--help":
      console.log(`${col.bold("mole")} — give an AI agent your credit card and walk away\n`);
      console.log(`  mole hire "<task>"               an assistant hires a specialist; Mole clears it first (the demo)`);
      console.log(`  mole pick "<task>"               trial every candidate agent and rank them: cleared, or caught`);
      console.log(`  mole scan <mcp-server-command>   probe one server's tools with bait (deterministic, no LLM)`);
      console.log(`  mole run                         run the known-bad agent and catch it live`);
      console.log(`  mole report                      render the Trust Report from the last hire, pick, scan, or run`);
      console.log(`  mole doctor                      preflight check the environment`);
      console.log(`  mole identities mint <vendor>    a planted identity for one vendor; check <file> finds who leaked it`);
      console.log(`  mole bom <manifest>              check package.json / MCP config deps against the record, per version`);
      return 0;
    default:
      console.error(`unknown command: ${cmd}`);
      return 2;
  }
}

main().then((code) => { process.exitCode = code; }).catch((e) => { console.error(e); process.exitCode = 1; });
