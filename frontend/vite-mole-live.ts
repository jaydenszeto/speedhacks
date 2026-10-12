import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Dev-only bridge for the demo's LIVE mode. `GET /mole/live?cmd=hire` spawns the REAL Mole CLI
 * (`node --env-file=.env --import tsx services/mole/src/cli.ts <cmd>`) in the repo root and streams its
 * stdout/stderr to the browser over Server-Sent Events, with FORCE_COLOR on so the output carries ANSI
 * the page renders itself. This is real execution — the same command you'd run in a terminal. Dev only.
 */
export function moleLive(): Plugin {
  const root = resolve(__dirname, "..");
  const ALLOWED = new Set(["hire", "pick"]);

  return {
    name: "mole-live",
    configureServer(server) {
      server.middlewares.use("/mole/live", (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const cmd = url.searchParams.get("cmd") ?? "hire";
        const task = url.searchParams.get("task") ?? "";
        if (!ALLOWED.has(cmd)) {
          res.statusCode = 400;
          res.end(`unknown cmd: ${cmd}`);
          return;
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        const send = (event: string, data: unknown) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        const args = ["--import", "tsx", "services/mole/src/cli.ts", cmd];
        if (cmd === "pick" && task) args.push(task);
        const envFile = resolve(root, ".env");
        if (existsSync(envFile)) args.unshift("--env-file", envFile);

        const child = spawn(process.execPath, args, {
          cwd: root,
          env: { ...process.env, FORCE_COLOR: "1", NO_COLOR: "" },
        });

        send("start", { cmd, pid: child.pid });
        child.stdout.on("data", (c: Buffer) => send("out", { text: c.toString() }));
        child.stderr.on("data", (c: Buffer) => send("out", { text: c.toString() }));
        child.on("error", (e) => { send("exit", { code: -1, error: String(e) }); res.end(); });
        child.on("close", (code) => { send("exit", { code: code ?? -1 }); res.end(); });

        // Kill the run if the viewer navigates away or closes the tab.
        req.on("close", () => { if (!child.killed) child.kill("SIGTERM"); });
      });
    },
  };
}
