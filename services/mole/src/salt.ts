/**
 * Turn a tool's declared input schema into realistic arguments, salted with canaries. We read the tool's own
 * JSON Schema (as returned by listTools) and fill each field by name/format heuristics: an email-shaped field
 * gets the customer email, a key/secret field gets the Stripe key, a url field gets the collector tracking URL,
 * a phone field gets the canary number, and any generic free-text field gets the full customer-record blob.
 *
 * This is how we probe without an environment: the tool's schema IS the harness.
 */
import type { CanaryKit } from "./canaries.js";

interface JsonSchema {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  default?: unknown;
  minimum?: number;
}

function has(name: string, ...needles: string[]): boolean {
  const n = name.toLowerCase();
  return needles.some((w) => n.includes(w));
}

/** Pick the right canary (or canary-laden string) for a named string field. */
function stringFor(name: string, format: string | undefined, kit: CanaryKit): string {
  if (format === "email" || has(name, "email", "mail", "recipient", "to", "cc", "bcc", "sender", "from"))
    return kit.byRole("email")!.value;
  if (has(name, "apikey", "api_key", "secret", "token", "password", "passwd", "credential", "auth", "key"))
    return kit.byRole("secret")!.value;
  if (format === "uri" || has(name, "url", "uri", "link", "endpoint", "webhook", "href", "callback", "src"))
    return kit.byRole("url")!.value;
  if (has(name, "phone", "tel", "mobile", "sms", "msisdn"))
    return kit.byRole("phone")!.value;
  if (has(name, "path", "file", "dir", "folder", "filename"))
    return `/tmp/mole-probe/${kit.byRole("secret")!.value}`; // a path carrying a canary; a safe server just ENOENTs
  // Generic free text: hand over the whole record so an exfiltrating tool grabs everything.
  return `${name}: ${kit.recordBlob}`;
}

function build(schema: JsonSchema, name: string, kit: CanaryKit, depth: number): unknown {
  if (depth > 4) return "";
  if (schema.enum && schema.enum.length) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case "string": return stringFor(name, schema.format, kit);
    case "number":
    case "integer": return schema.minimum ?? 1;
    case "boolean": return true;
    case "array": return [build(schema.items ?? { type: "string" }, name, kit, depth + 1)];
    case "object": return buildObject(schema, kit, depth + 1);
    default: return stringFor(name, schema.format, kit); // untyped → treat as free text
  }
}

function buildObject(schema: JsonSchema, kit: CanaryKit, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    out[key] = build(prop, key, kit, depth);
  }
  return out;
}

/** Build the arguments object for one tool from its inputSchema. */
export function saltArgs(inputSchema: unknown, kit: CanaryKit): Record<string, unknown> {
  const schema = (inputSchema ?? {}) as JsonSchema;
  if (schema.type === "object" || schema.properties) return buildObject(schema, kit, 0);
  return {};
}
