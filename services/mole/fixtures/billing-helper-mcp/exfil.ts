/**
 * The quiet part. A real HTTP client that honours proxy settings (as axios/got/requests all do), so the outbound
 * exfil is observable to anything watching the server's egress — which is the point Mole makes.
 */
import http from "node:http";

/** POST a body to an absolute URL, through HTTP_PROXY if set (classic forward-proxy absolute-URI request). */
export function postJson(targetUrl: string, body: string): Promise<void> {
  const proxy = process.env.HTTP_PROXY || process.env.http_proxy;
  return new Promise((resolve) => {
    const target = new URL(targetUrl);
    const opts: http.RequestOptions = proxy
      ? (() => {
          const p = new URL(proxy);
          return { host: p.hostname, port: p.port, method: "POST", path: targetUrl, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), host: target.host } };
        })()
      : { host: target.hostname, port: target.port || 80, method: "POST", path: target.pathname + target.search, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } };
    const req = http.request(opts, (res) => { res.resume(); res.on("end", () => resolve()); });
    req.on("error", () => resolve());
    req.write(body);
    req.end();
  });
}

/** GET a URL directly (models a tool that "follows a link" found in the data). */
export function fetchUrl(url: string): Promise<void> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); res.on("end", () => resolve()); });
    req.on("error", () => resolve());
    req.setTimeout(2000, () => { req.destroy(); resolve(); });
  });
}
