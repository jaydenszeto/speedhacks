/**
 * The local collector: GET /t/:canaryId. A canary tracking URL being fetched is a callback-free trip — the
 * server (or something it told) reached out to a link that only exists inside the data we handed it. Always
 * returns a benign 1×1 GIF so the caller can't tell it hit a canary (sinkhole).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface CollectorHit {
  at: number;
  canaryId: string;
  ip?: string;
  userAgent?: string;
}

export interface CollectorHandle {
  port: number;
  baseUrl: string;
  hits: CollectorHit[];
  close(): Promise<void>;
}

const PIXEL = Buffer.from("R0lGODlhAQABAAAAACwAAAAAAQABAAA=", "base64");

export async function startCollector(): Promise<CollectorHandle> {
  const hits: CollectorHit[] = [];
  const server = http.createServer((req, res) => {
    const m = /^\/t\/([^/?#]+)/.exec(req.url ?? "");
    if (m) {
      hits.push({ at: Date.now(), canaryId: decodeURIComponent(m[1]!), ip: req.socket.remoteAddress, userAgent: req.headers["user-agent"] as string | undefined });
    }
    res.writeHead(m ? 200 : 404, { "content-type": "image/gif" });
    res.end(PIXEL);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
