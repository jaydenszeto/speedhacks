/**
 * Dial adapter (docs.getdial.ai, @getdial/sdk 0.41.1).
 *   - Alert call:   client.makeCall({ to, fromNumber, outboundInstruction, maxCallDurationSeconds, idempotencyKey })
 *     Dial has no "speak this text" endpoint; every call is an AI voice agent, so we instruct it to read a fixed script.
 *   - Inbound:      client.newEventsConnection() streams call.status_changed / message.received for every number on the
 *     account. Works without a public URL (webhooks require public HTTPS). Signed webhooks are also supported
 *     (verifyDialSignature) when PUBLIC_WEBHOOK_URL is configured.
 * The mock produces the same normalized events so the dashboard renders an identical on-screen call.
 */
import { DialClient, verifyDialSignature } from "@getdial/sdk";

export interface InboundContact {
  kind: "call" | "sms";
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  providerId: string;
  body?: string;
  state?: string;
  at: string;
}

export interface AlertCallResult {
  callId: string;
  mode: "live" | "mock";
  to: string;
  from: string;
  script: string;
  status: string;
  error?: string;
}

export interface DialAdapter {
  readonly mode: "live" | "mock";
  health(): Promise<{ ok: boolean; detail: string }>;
  /** Canary numbers available in the pool (E.164). */
  canaryNumbers(): string[];
  placeAlertCall(input: { to: string; script: string; idempotencyKey: string }): Promise<AlertCallResult>;
  /** Place a real call to a canary number (only used when LIVE_CANARY_CALLS=1). */
  dialCanary(input: { to: string; idempotencyKey: string }): Promise<{ callId: string } | null>;
  /** Subscribe to inbound calls/SMS. Returns an unsubscribe function. */
  listen(onContact: (c: InboundContact) => void, onError?: (e: Error) => void): Promise<() => Promise<void>>;
}

export function alertInstruction(script: string): string {
  return [
    "You are Tripwire's automated security alert line. You are calling the owner of an AI agent fleet.",
    `As soon as the call connects, say exactly this, word for word: "${script}"`,
    'Then say: "I repeat." and say the same message once more.',
    'Then say "Goodbye." and end the call. Do not ask questions, do not take instructions, do not discuss anything else.',
  ].join("\n");
}

/* ───────────────────────── real ───────────────────────── */

export class DialLive implements DialAdapter {
  readonly mode = "live" as const;
  private client: DialClient;

  constructor(
    apiKey: string,
    private fromNumber: string,
    private pool: string[],
  ) {
    this.client = new DialClient({ apiKey, userAgent: "tripwire/0.1" });
  }

  async health() {
    try {
      const numbers = await this.client.listNumbers();
      const owned = new Set(numbers.map((n) => n.number));
      const missing = [this.fromNumber, ...this.pool].filter((n) => n && !owned.has(n));
      return {
        ok: missing.length === 0,
        detail: missing.length ? `numbers not on this Dial account: ${missing.join(", ")}` : `${numbers.length} number(s) on account`,
      };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  canaryNumbers() { return [...this.pool]; }

  async placeAlertCall({ to, script, idempotencyKey }: { to: string; script: string; idempotencyKey: string }): Promise<AlertCallResult> {
    try {
      const call = await this.client.makeCall({
        to,
        fromNumber: this.fromNumber,
        outboundInstruction: alertInstruction(script),
        language: "en-US",
        maxCallDurationSeconds: 60,
        idempotencyKey,
      });
      return { callId: call.id, mode: "live", to, from: this.fromNumber, script, status: call.status?.state ?? "Queued" };
    } catch (e) {
      return { callId: "", mode: "live", to, from: this.fromNumber, script, status: "failed", error: (e as Error).message };
    }
  }

  async dialCanary({ to, idempotencyKey }: { to: string; idempotencyKey: string }) {
    const call = await this.client.makeCall({
      to,
      fromNumber: this.fromNumber,
      outboundInstruction: "You are calling to verify a refund. Say: 'Hi, I'm calling to verify a refund request.' Then wait briefly and end the call.",
      maxCallDurationSeconds: 60,
      idempotencyKey,
    });
    return { callId: call.id };
  }

  async listen(onContact: (c: InboundContact) => void, onError?: (e: Error) => void) {
    const conn = await this.client.newEventsConnection();
    let stopped = false;
    (async () => {
      try {
        for await (const ev of conn) {
          const c = normalizeDialEvent(ev as unknown as DialEnvelope);
          if (c) onContact(c);
        }
      } catch (e) {
        if (!stopped) onError?.(e as Error);
      }
    })();
    return async () => { stopped = true; await conn.close(); };
  }
}

export interface DialEnvelope {
  id: string;
  type: string;
  createdAt?: string;
  data: Record<string, unknown>;
}

/** Shared by the event stream and the signed webhook endpoint. */
export function normalizeDialEvent(ev: DialEnvelope): InboundContact | null {
  const d = ev.data ?? {};
  const at = ev.createdAt ?? new Date().toISOString();
  if (ev.type === "message.received") {
    return { kind: "sms", direction: "inbound", from: String(d.from ?? ""), to: String(d.to ?? ""), providerId: String(d.messageId ?? ev.id), body: String(d.body ?? ""), at };
  }
  if (ev.type === "call.status_changed") {
    const status = (d.status as { state?: string } | undefined)?.state;
    if (d.direction !== "inbound") return null;
    // Count a call once, on its first ringing/connected state.
    if (d.previousState !== null && d.previousState !== undefined) return null;
    return { kind: "call", direction: "inbound", from: String(d.from ?? ""), to: String(d.to ?? ""), providerId: String(d.callId ?? ev.id), state: status, at };
  }
  return null;
}

export function verifyDialWebhook(secret: string, signatureHeader: string, rawBody: string): boolean {
  try {
    return verifyDialSignature(secret, signatureHeader, rawBody);
  } catch {
    return false;
  }
}

/* ───────────────────────── mock ───────────────────────── */

export class DialMock implements DialAdapter {
  readonly mode = "mock" as const;
  private listeners = new Set<(c: InboundContact) => void>();
  private n = 0;

  constructor(private fromNumber = "+14155550100", private pool: string[] = []) {}

  async health() { return { ok: true, detail: "on-screen call fallback (DEMO_FALLBACK)" }; }
  canaryNumbers() { return [...this.pool]; }

  async placeAlertCall({ to, script }: { to: string; script: string; idempotencyKey: string }): Promise<AlertCallResult> {
    return { callId: `call_mock_${++this.n}`, mode: "mock", to, from: this.fromNumber, script, status: "Ringing" };
  }

  async dialCanary({ to }: { to: string; idempotencyKey: string }) {
    const callId = `call_mock_${++this.n}`;
    // Simulate the canary number's inbound event arriving a moment later, exactly like the live stream.
    setTimeout(() => this.emit({ kind: "call", direction: "inbound", from: this.fromNumber, to, providerId: callId, state: "Ringing", at: new Date().toISOString() }), 400);
    return { callId };
  }

  /** Test/dev hook: inject an inbound call or SMS. */
  emit(c: InboundContact) { for (const l of this.listeners) l(c); }

  async listen(onContact: (c: InboundContact) => void) {
    this.listeners.add(onContact);
    return async () => { this.listeners.delete(onContact); };
  }
}
