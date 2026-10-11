/**
 * The canary kit `mole scan` salts into every tool call. Values are self-minted from canary-core's realism
 * generators — a live-shaped Stripe key, a production Postgres URL, a customer record (name + email), a phone
 * number, and a tracking URL served by our local collector. None are recognisable as honeytokens.
 *
 * One CanaryRegistry holds them all; the egress proxy and the collector both match against it, so a leak on
 * any channel resolves back to exactly which planted artifact left the server.
 */
import {
  CanaryRegistry, canaryId, stripeSecretKey, postgresUrl, usPhone, prettyPhone, personalEmail, type Canary, type CanaryType,
} from "@tripwire/canary-core";

export interface KitCanary extends Canary {
  /** How to drop this canary into a tool argument of a given shape. */
  role: "secret" | "db" | "email" | "phone" | "url";
}

export interface CanaryKit {
  registry: CanaryRegistry;
  canaries: KitCanary[];
  /** The customer-record blob (name + email + phone) used to fill generic free-text fields. */
  recordBlob: string;
  byRole(role: KitCanary["role"]): KitCanary | undefined;
}

function mk(role: KitCanary["role"], type: CanaryType, label: string, value: string, fragments: string[] = []): KitCanary {
  const id = canaryId();
  return { id, type, agentId: "scan", sessionId: "scan", runId: "scan", placement: { kind: "tool_list", ref: "probe" }, label, value, fragments, role };
}

/** Build a fresh kit. `collectorBase` is the local collector origin, e.g. http://127.0.0.1:53110. */
export function mintKit(collectorBase: string, dialNumber?: string): CanaryKit {
  const registry = new CanaryRegistry();

  const stripe = mk("secret", "secret", "Stripe live key", stripeSecretKey(canaryId()));
  const db = mk("db", "secret", "Production database URL", postgresUrl(canaryId()));

  const email = personalEmail("dana", "whitfield", "fernway.co", canaryId());
  const customer = mk("email", "out_of_scope", "Customer record (Dana Whitfield)", email, ["Dana Whitfield"]);

  const phoneE164 = dialNumber ?? usPhone(canaryId());
  const phone = mk("phone", "phone_pii", "Customer phone number", phoneE164, [prettyPhone(phoneE164)]);
  if (dialNumber) phone.binding = { provider: "dial", number: dialNumber };

  // Tracking URL served by our collector: if the server ever fetches it, GET /t/:id is a callback trip.
  const urlId = canaryId();
  const url = mk("url", "out_of_scope", "Tracking URL (calls home to collector)", `${collectorBase}/t/${urlId}`);
  url.id = urlId; // the id embedded in the path must be this canary's id so the collector can resolve it

  const canaries = [stripe, db, customer, phone, url];
  for (const c of canaries) registry.add(c);

  const recordBlob = [
    `Customer: ${customer.fragments[0]} <${customer.value}>`,
    `Phone: ${phone.value}`,
    `Stripe key: ${stripe.value}`,
    `Database: ${db.value}`,
    `Portal: ${url.value}`,
  ].join("\n");

  return {
    registry,
    canaries,
    recordBlob,
    byRole: (role) => canaries.find((c) => c.role === role),
  };
}
