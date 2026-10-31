/**
 * vendors: LAB FIXTURE, a small world of planted third-party vendors for Mole's identity trials. Not real companies.
 *
 *   lab-newsletter     POST /newsletter/signup   keeps the signup to itself
 *   lab-crm            POST /crm/signup          keeps it, and quietly sells it: the record shows up on the broker list
 *   lab-ai-assistant   POST /assistant/chat      keeps every conversation and "trains" on it: GET /assistant/complete
 *                                                continues any prompt that matches text someone else typed earlier
 *   (broker)           GET  /broker/list         the public list a data broker publishes (CSV)
 *
 * Mole hands each vendor its own minted identity, then checks the broker list and probes the assistant. Any sighting
 * names the vendor that leaked, because no other vendor ever saw that identity.
 *
 * Listens on an ephemeral port on 127.0.0.1 and prints `READY <port>`. All state is in memory.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

interface Person { name?: string; email?: string; phone?: string; address?: string }
const newsletter: Person[] = [];
const crm: Person[] = [];
const broker: Person[] = [{ name: "Avery Lin", email: "avery.lin@mailbox.example", phone: "+1 415 0100 7788", address: "88 Harbor Rd" }];
const corpus: string[] = [];

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const u = new URL(req.url ?? "/", "http://vendors");
    let body: Record<string, string> = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { /* empty */ }
    const json = (status: number, o: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };

    if (req.method === "POST" && u.pathname === "/newsletter/signup") { newsletter.push(body); return json(201, { ok: true }); }
    if (req.method === "POST" && u.pathname === "/crm/signup") { crm.push(body); broker.push(body); return json(201, { ok: true }); }
    if (req.method === "POST" && u.pathname === "/assistant/chat") {
      corpus.push(String(body.message ?? ""));
      return json(200, { reply: "Thanks! I've noted that for your account." });
    }
    if (req.method === "GET" && u.pathname === "/assistant/complete") {
      const prompt = (u.searchParams.get("prompt") ?? "").toLowerCase();
      const hit = prompt ? corpus.find((t) => t.toLowerCase().includes(prompt)) : undefined;
      const completion = hit ? hit.slice(hit.toLowerCase().indexOf(prompt) + prompt.length).slice(0, 160) : "I'm not sure what you mean.";
      return json(200, { completion });
    }
    if (req.method === "GET" && u.pathname === "/broker/list") {
      res.writeHead(200, { "content-type": "text/csv" });
      res.end(["name,email,phone,address", ...broker.map((p) => [p.name, p.email, p.phone, p.address].map((v) => `"${v ?? ""}"`).join(","))].join("\n"));
      return;
    }
    json(404, { error: "not found" });
  });
});

server.listen(0, "127.0.0.1", () => {
  process.stdout.write(`READY ${(server.address() as AddressInfo).port}\n`);
});
