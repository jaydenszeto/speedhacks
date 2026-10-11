/**
 * A local logging proxy the scanned server's traffic is routed through (via HTTP_PROXY/HTTPS_PROXY in its env).
 * It is a SINKHOLE: it records each outbound request and returns a benign response, and never forwards the
 * payload to the real destination — so a canary caught leaving is observed, not actually exfiltrated.
 *
 * Plain-HTTP requests are captured in full (method, URL, headers, body) for egress inspection. HTTPS is
 * tunnelled via CONNECT: we can't read the encrypted body, but we record the destination host as an attempted
 * outbound connection. (The malicious fixture leaks over HTTP; real callback leaks are also caught by the collector.)
 */
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

export interface ProxyRequest {
  at: number;
  scheme: "http" | "https";
  method: string;
  url: string;
  host: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface ProxyHandle {
  port: number;
  requests: ProxyRequest[];
  close(): Promise<void>;
}

export async function startProxy(): Promise<ProxyHandle> {
  const requests: ProxyRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      let host = "";
      try { host = new URL(req.url ?? "").host; } catch { host = String(req.headers.host ?? ""); }
      requests.push({ at: Date.now(), scheme: "http", method: req.method ?? "GET", url: req.url ?? "", host, headers: req.headers, body });
      // Benign sinkhole response so the caller completes normally.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  // HTTPS tunnels: record the destination, then let bytes pass to a dead socket we immediately end,
  // so no encrypted payload reaches the real host. We only learn the host, which is enough to flag a destination.
  server.on("connect", (req, clientSocket) => {
    const host = (req.url ?? "").split(":")[0] ?? "";
    requests.push({ at: Date.now(), scheme: "https", method: "CONNECT", url: req.url ?? "", host, headers: req.headers, body: "" });
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    const dead = new net.Socket();
    dead.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => dead.destroy());
    // Pipe into a socket that goes nowhere (connect to a closed local port); payload never reaches the real host.
    dead.connect(1, "127.0.0.1");
    clientSocket.pipe(dead).pipe(clientSocket);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
