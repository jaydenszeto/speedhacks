/**
 * Runs INSIDE a Vercel Sandbox microVM (see microvm.ts). The function that started the VM has already installed the
 * package (scripts off) and switched the VM's network to deny-all. This script is the same trial as the Docker
 * sandbox, just one level in: scan() spawns the server with our observer preloaded, probes every tool with bait,
 * and reads back every outbound attempt the observer logged. The attempts fail, because the VM has no network.
 *
 *   node microvm-runner.mjs <bin> <observe.cjs> '<required env names as JSON>'
 *
 * Output: one line per event on stdout, `@@mole {"event":…}`, then `@@mole {"result":…}`. Events are already
 * redacted by scan(). The result's findings drop `matched` / `evidence` (the raw bait); the lab takes both from
 * the redacted finding events.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan, type Runner } from "../scan.js";
import { countSource } from "../sourcecount.js";
import { readEgress } from "./egress.js";

export const MARK = "@@mole ";

const [bin, observer, envJson = "[]"] = process.argv.slice(2);
if (!bin || !observer) {
  console.error("usage: microvm-runner <bin> <observe.cjs> [requiredEnvJSON]");
  process.exit(2);
}

const out = (o: unknown) => process.stdout.write(MARK + JSON.stringify(o) + "\n");
const egress = join(mkdtempSync(join(tmpdir(), "mole-")), "egress.jsonl");

const runner: Runner = async ({ baitEnv }) => ({
  name: "sandbox",
  command: process.execPath,
  args: [bin],
  env: {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: tmpdir(),
    ...baitEnv,
    NODE_OPTIONS: `--require=${observer}`,
    MOLE_EGRESS: egress,
  },
  requests: () => readEgress(egress),
  source: countSource("node", [bin]),
  close: async () => undefined,
});

const result = await scan({
  command: "node", args: [bin], runner, baitEnvNames: JSON.parse(envJson) as string[], onEvent: (event) => {
    if (event.type !== "done") out({ event });
  },
});
out({ result: { ...result, findings: result.findings.map((f) => ({ ...f, matched: "", evidence: "" })) } });
process.exit(0);
