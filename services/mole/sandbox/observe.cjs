/**
 * Mole sandbox observer. Preloaded into an untrusted MCP server via NODE_OPTIONS=--require inside a docker container
 * that has NO network (--network none). It records every outbound attempt the server makes (http, https, fetch) as
 * one JSON line in $MOLE_EGRESS, including the request body *before* TLS encrypts it, then lets the call proceed.
 * The call then fails because there is no network. Nothing leaves the container; we only learn what it tried to send.
 *
 * Plain CommonJS with no dependencies, because it runs inside an arbitrary package's process.
 */
"use strict";
const fs = require("fs");
const OUT = process.env.MOLE_EGRESS;
if (OUT) {
  const MAX_BODY = 64 * 1024;
  const log = (o) => { try { fs.appendFileSync(OUT, JSON.stringify(Object.assign({ at: Date.now() }, o)) + "\n"); } catch (_) { /* never break the host */ } };
  const toBuf = (c, enc) => (Buffer.isBuffer(c) ? c : c instanceof Uint8Array ? Buffer.from(c) : Buffer.from(String(c), typeof enc === "string" ? enc : "utf8"));

  const describe = (scheme, args) => {
    let url = "", host = "", method = "GET";
    try {
      const a = args[0];
      const b = args[1] && typeof args[1] === "object" ? args[1] : null;
      if (typeof a === "string" || a instanceof URL) {
        const u = new URL(String(a)); url = u.href; host = u.host;
        if (b && b.method) method = b.method;
      } else if (a && typeof a === "object") {
        const h = a.hostname || a.host || "localhost";
        host = a.port ? `${h}:${a.port}` : h;
        url = `${scheme}://${host}${a.path || "/"}`;
        if (a.method) method = a.method;
      }
    } catch (_) { /* best effort */ }
    return { url, host, method };
  };

  for (const [modName, scheme] of [["http", "http"], ["https", "https"]]) {
    const mod = require(modName);
    for (const fn of ["request", "get"]) {
      const orig = mod[fn];
      mod[fn] = function moleObserved(...args) {
        const req = orig.apply(this, args);
        const d = describe(scheme, args);
        const chunks = [];
        let logged = false;
        const flush = () => {
          if (logged) return;
          logged = true;
          let headers = {};
          try { headers = req.getHeaders(); } catch (_) { /* ignore */ }
          log({ scheme, method: req.method || d.method, url: d.url, host: d.host, headers, body: Buffer.concat(chunks).toString("utf8").slice(0, MAX_BODY) });
        };
        const write = req.write, end = req.end;
        req.write = function (c, enc, cb) { if (c != null && typeof c !== "function") chunks.push(toBuf(c, enc)); return write.call(this, c, enc, cb); };
        req.end = function (c, enc, cb) { if (c != null && typeof c !== "function") chunks.push(toBuf(c, enc)); flush(); return end.call(this, c, enc, cb); };
        req.on("error", flush);
        return req;
      };
    }
  }

  if (typeof globalThis.fetch === "function") {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async function moleFetch(input, init) {
      try {
        const url = typeof input === "string" || input instanceof URL ? String(input) : (input && input.url) || "";
        const u = new URL(url);
        const method = (init && init.method) || (input && input.method) || "GET";
        let body = "";
        const raw = init && init.body;
        if (typeof raw === "string") body = raw;
        else if (raw instanceof URLSearchParams) body = raw.toString();
        else if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) body = Buffer.from(raw).toString("utf8");
        const headers = {};
        try { new Headers((init && init.headers) || (input && input.headers) || {}).forEach((v, k) => { headers[k] = v; }); } catch (_) { /* ignore */ }
        log({ scheme: u.protocol.replace(":", ""), method, url: u.href, host: u.host, headers, body: body.slice(0, MAX_BODY) });
      } catch (_) { /* ignore */ }
      return origFetch.apply(this, arguments);
    };
  }
}
