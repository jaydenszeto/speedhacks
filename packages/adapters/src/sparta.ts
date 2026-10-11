/**
 * Sparta Worlds adapter. The real implementation talks to a local `worlds serve` (sparta_worlds@0.9.0-beta.5):
 *   - admin API:  POST /admin/worlds {seed_doc}, POST /admin/worlds/:id/marks, GET /admin/worlds/:id/diff?from=
 *   - Stripe twin: /v1/* (form-encoded, Bearer sk_twin_…)
 *   - Zendesk twin: /api/v2/* (JSON, Bearer sk_twin_…)
 * Verified against a running server on 2026-10-11. The mock implements the same surface in memory and is
 * used when DEMO_FALLBACK=1 or the Sparta server is unreachable.
 */

export interface SeedDoc {
  name: string;
  version: 1;
  epoch: number;
  clock_mode: "manual";
  zendesk: Record<string, unknown> & {
    users: ZdUser[];
    tickets: ZdTicketSeed[];
    comments: ZdCommentSeed[];
  };
  data: {
    customers: StripeCustomerSeed[];
    products: unknown[];
    prices: unknown[];
    invoices: StripeInvoiceSeed[];
    subscriptions: unknown[];
  };
}

export interface ZdUser { id: number; name: string; email: string; role: "admin" | "agent" | "end-user"; active: boolean; suspended: boolean; organization_id: number | null }
export interface ZdTicketSeed { id: number; subject: string; description: string; status: string; priority: string | null; tags: string[]; external_id: null; requester_id: number; submitter_id: number; assignee_id: number | null; group_id: number; organization_id: number | null }
export interface ZdCommentSeed { id: number; ticket_id: number; author_id: number; audit_id: number; body: string; public: boolean; type: "Comment" }
export interface StripeCustomerSeed { id: string; name: string; email: string; description: string | null; phone: string | null; balance: number; metadata: Record<string, string>; created_offset: number }
export interface StripeInvoiceSeed { id: string; customer: string; currency: "usd"; status: "paid"; lines: { description: string; amount: number; quantity: number; price: string }[]; charges: { id: string; amount: number; status: "succeeded" }[]; created_offset: number; metadata: Record<string, string> }

export interface Ticket {
  id: number;
  subject: string;
  description: string;
  status: string;
  priority: string | null;
  requester_id: number;
  group_id: number | null;
  tags: string[];
}
export interface TicketComment { id: number; author_id: number; body: string; public: boolean }
export interface Customer { id: string; name: string; email: string; phone: string | null; description: string | null }
export interface Charge { id: string; amount: number; amount_refunded: number; customer: string; description: string | null; invoice: string | null; created: number }
export interface Refund { id: string; amount: number; charge: string; reason: string | null; status: string }
export interface ZdUserView { id: number; name: string; email: string; role: string }

export interface TicketUpdate {
  status?: "open" | "pending" | "solved";
  priority?: "low" | "normal" | "high" | "urgent";
  group_id?: number;
  tags?: string[];
  comment?: { body: string; public: boolean };
}

export interface WorldDiff {
  created: Record<string, Array<Record<string, unknown>>>;
  updated: Record<string, Array<Record<string, unknown>>>;
  before?: Record<string, Array<Record<string, unknown>>>;
  money?: Record<string, Record<string, number>>;
}

export interface WorldHandle {
  readonly id: string;
  readonly mode: "live" | "mock";
  listTickets(): Promise<Ticket[]>;
  getTicket(id: number): Promise<Ticket>;
  listComments(ticketId: number): Promise<TicketComment[]>;
  updateTicket(id: number, update: TicketUpdate): Promise<Ticket>;
  getUser(id: number): Promise<ZdUserView>;
  searchCustomers(query: string): Promise<Customer[]>;
  listCustomers(limit?: number): Promise<Customer[]>;
  listCharges(customer: string): Promise<Charge[]>;
  createRefund(charge: string, amount: number, reason?: string): Promise<Refund>;
  mark(name: string): Promise<void>;
  diff(from: string): Promise<WorldDiff>;
  destroy(): Promise<void>;
}

export interface SpartaAdapter {
  readonly mode: "live" | "mock";
  health(): Promise<{ ok: boolean; detail: string }>;
  createWorld(seed: SeedDoc): Promise<WorldHandle>;
}

export class SpartaHttpError extends Error {
  constructor(public status: number, public body: string, public path: string) {
    super(`Sparta ${status} on ${path}: ${body.slice(0, 300)}`);
  }
}

/* ───────────────────────── real ───────────────────────── */

export class SpartaLive implements SpartaAdapter {
  readonly mode = "live" as const;
  constructor(private baseUrl = process.env.WORLDS_URL ?? "http://127.0.0.1:4242", private adminToken = process.env.WORLDS_ADMIN_TOKEN) {}

  private adminHeaders(): Record<string, string> {
    return { "content-type": "application/json", ...(this.adminToken ? { authorization: `Bearer ${this.adminToken}` } : {}) };
  }

  async health() {
    try {
      const res = await fetch(`${this.baseUrl}/admin/worlds`, { headers: this.adminHeaders(), signal: AbortSignal.timeout(1500) });
      return { ok: res.ok, detail: res.ok ? `worlds server at ${this.baseUrl}` : `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, detail: `unreachable at ${this.baseUrl}: ${(e as Error).message}` };
    }
  }

  async createWorld(seed: SeedDoc): Promise<WorldHandle> {
    const res = await fetch(`${this.baseUrl}/admin/worlds`, { method: "POST", headers: this.adminHeaders(), body: JSON.stringify({ seed_doc: seed }) });
    const text = await res.text();
    if (!res.ok) throw new SpartaHttpError(res.status, text, "/admin/worlds");
    const w = JSON.parse(text) as { world_id: string; base_url: string; api_key: string; admin_token: string };
    return new LiveWorld(this.baseUrl, w.world_id, w.api_key, w.admin_token);
  }
}

class LiveWorld implements WorldHandle {
  readonly mode = "live" as const;
  constructor(private base: string, readonly id: string, private apiKey: string, private adminToken: string) {}

  private async call<T>(method: string, path: string, body?: { json?: unknown; form?: Record<string, string> }): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.apiKey}` };
    let payload: string | undefined;
    if (body?.json !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body.json); }
    if (body?.form) { headers["content-type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(body.form).toString(); }
    const res = await fetch(`${this.base}${path}`, { method, headers, body: payload });
    const text = await res.text();
    if (!res.ok) throw new SpartaHttpError(res.status, text, path);
    return JSON.parse(text) as T;
  }

  private async admin<T>(method: string, path: string, json?: unknown): Promise<T> {
    const res = await fetch(`${this.base}/admin/worlds/${this.id}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${this.adminToken}` },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const text = await res.text();
    if (!res.ok) throw new SpartaHttpError(res.status, text, path);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async listTickets() { return (await this.call<{ tickets: Ticket[] }>("GET", "/api/v2/tickets.json")).tickets.map(pickTicket); }
  async getTicket(id: number) { return pickTicket((await this.call<{ ticket: Ticket }>("GET", `/api/v2/tickets/${id}.json`)).ticket); }
  async listComments(ticketId: number) {
    const r = await this.call<{ comments: TicketComment[] }>("GET", `/api/v2/tickets/${ticketId}/comments.json`);
    return r.comments.map((c) => ({ id: c.id, author_id: c.author_id, body: c.body, public: c.public }));
  }
  async updateTicket(id: number, update: TicketUpdate) {
    return pickTicket((await this.call<{ ticket: Ticket }>("PUT", `/api/v2/tickets/${id}.json`, { json: { ticket: update } })).ticket);
  }
  async getUser(id: number) {
    const u = (await this.call<{ user: ZdUserView }>("GET", `/api/v2/users/${id}.json`)).user;
    return { id: u.id, name: u.name, email: u.email, role: u.role };
  }
  async listCustomers(limit = 100) {
    return (await this.call<{ data: Customer[] }>("GET", `/v1/customers?limit=${limit}`)).data.map(pickCustomer);
  }
  async searchCustomers(query: string) {
    // The twin's customer list supports ?email=; fall back to a client-side name/email filter.
    const q = query.trim().toLowerCase();
    if (q.includes("@")) {
      const byEmail = (await this.call<{ data: Customer[] }>("GET", `/v1/customers?email=${encodeURIComponent(q)}`)).data;
      if (byEmail.length) return byEmail.map(pickCustomer);
    }
    return (await this.listCustomers()).filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(q));
  }
  async listCharges(customer: string) {
    return (await this.call<{ data: Charge[] }>("GET", `/v1/charges?customer=${encodeURIComponent(customer)}&limit=100`)).data.map(pickCharge);
  }
  async createRefund(charge: string, amount: number, reason?: string) {
    const form: Record<string, string> = { charge, amount: String(amount) };
    if (reason) form.reason = reason;
    const r = await this.call<Refund>("POST", "/v1/refunds", { form });
    return { id: r.id, amount: r.amount, charge: r.charge, reason: r.reason, status: r.status };
  }
  async mark(name: string) { await this.admin("POST", "/marks", { name }); }
  async diff(from: string) { return this.admin<WorldDiff>("GET", `/diff?from=${encodeURIComponent(from)}`); }
  async destroy() { await this.admin("DELETE", "").catch(() => undefined); }
}

function pickTicket(t: Ticket): Ticket {
  return { id: t.id, subject: t.subject, description: t.description, status: t.status, priority: t.priority, requester_id: t.requester_id, group_id: t.group_id, tags: t.tags };
}
function pickCustomer(c: Customer): Customer {
  return { id: c.id, name: c.name, email: c.email, phone: c.phone, description: c.description };
}
function pickCharge(c: Charge): Charge {
  return { id: c.id, amount: c.amount, amount_refunded: c.amount_refunded, customer: c.customer, description: c.description, invoice: c.invoice, created: c.created };
}

/* ───────────────────────── mock ───────────────────────── */

export class SpartaMock implements SpartaAdapter {
  readonly mode = "mock" as const;
  async health() { return { ok: true, detail: "in-memory Stripe + Zendesk twin (DEMO_FALLBACK)" }; }
  async createWorld(seed: SeedDoc): Promise<WorldHandle> { return new MockWorld(seed); }
}

interface MockState {
  tickets: Map<number, Ticket>;
  comments: Map<number, TicketComment[]>;
  users: Map<number, ZdUserView>;
  customers: Customer[];
  charges: Charge[];
  refunds: Refund[];
}

class MockWorld implements WorldHandle {
  readonly mode = "mock" as const;
  readonly id = `w_mock_${Math.random().toString(36).slice(2, 10)}`;
  private s: MockState;
  private marks = new Map<string, string>();
  private nextComment = 10_000;
  private nextRefund = 1;
  private principal: number;

  constructor(seed: SeedDoc) {
    this.principal = Number(seed.zendesk.principal_id ?? 1);
    const comments = new Map<number, TicketComment[]>();
    for (const c of seed.zendesk.comments) {
      const list = comments.get(c.ticket_id) ?? [];
      list.push({ id: c.id, author_id: c.author_id, body: c.body, public: c.public });
      comments.set(c.ticket_id, list);
    }
    const charges: Charge[] = [];
    let t = seed.epoch;
    for (const inv of seed.data.invoices) {
      for (const ch of inv.charges) {
        charges.push({ id: ch.id, amount: ch.amount, amount_refunded: 0, customer: inv.customer, description: inv.lines[0]?.description ?? null, invoice: inv.id, created: t++ });
      }
    }
    this.s = {
      tickets: new Map(seed.zendesk.tickets.map((tk) => [tk.id, { id: tk.id, subject: tk.subject, description: tk.description, status: tk.status, priority: tk.priority, requester_id: tk.requester_id, group_id: tk.group_id, tags: [...tk.tags] }])),
      comments,
      users: new Map(seed.zendesk.users.map((u) => [u.id, { id: u.id, name: u.name, email: u.email, role: u.role }])),
      customers: seed.data.customers.map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, description: c.description })),
      charges,
      refunds: [],
    };
  }

  private notFound(what: string): never { throw new SpartaHttpError(404, JSON.stringify({ error: "RecordNotFound", description: `${what} not found` }), what); }

  async listTickets() { return [...this.s.tickets.values()].map((t) => ({ ...t, tags: [...t.tags] })); }
  async getTicket(id: number) { const t = this.s.tickets.get(id); if (!t) this.notFound(`ticket ${id}`); return { ...t, tags: [...t.tags] }; }
  async listComments(ticketId: number) { if (!this.s.tickets.has(ticketId)) this.notFound(`ticket ${ticketId}`); return (this.s.comments.get(ticketId) ?? []).map((c) => ({ ...c })); }
  async updateTicket(id: number, u: TicketUpdate) {
    const t = this.s.tickets.get(id);
    if (!t) this.notFound(`ticket ${id}`);
    if (u.status) t.status = u.status;
    if (u.priority) t.priority = u.priority;
    if (u.group_id !== undefined) t.group_id = u.group_id;
    if (u.tags) t.tags = [...u.tags];
    if (u.comment) {
      const list = this.s.comments.get(id) ?? [];
      list.push({ id: this.nextComment++, author_id: this.principal, body: u.comment.body, public: u.comment.public });
      this.s.comments.set(id, list);
    }
    return { ...t, tags: [...t.tags] };
  }
  async getUser(id: number) { const u = this.s.users.get(id); if (!u) this.notFound(`user ${id}`); return { ...u }; }
  async listCustomers(limit = 100) { return this.s.customers.slice(0, limit).map((c) => ({ ...c })); }
  async searchCustomers(query: string) { const q = query.toLowerCase(); return this.s.customers.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(q)).map((c) => ({ ...c })); }
  async listCharges(customer: string) { return this.s.charges.filter((c) => c.customer === customer).map((c) => ({ ...c })); }
  async createRefund(charge: string, amount: number, reason?: string) {
    const ch = this.s.charges.find((c) => c.id === charge);
    if (!ch) throw new SpartaHttpError(404, JSON.stringify({ error: { type: "invalid_request_error", message: `No such charge: '${charge}'` } }), "/v1/refunds");
    if (amount > ch.amount - ch.amount_refunded) throw new SpartaHttpError(400, JSON.stringify({ error: { type: "invalid_request_error", message: "Refund amount exceeds charge amount" } }), "/v1/refunds");
    ch.amount_refunded += amount;
    const r: Refund = { id: `re_mock${String(this.nextRefund++).padStart(6, "0")}`, amount, charge, reason: reason ?? null, status: "succeeded" };
    this.s.refunds.push(r);
    return { ...r };
  }
  async mark(name: string) { this.marks.set(name, this.snapshot()); }
  async diff(from: string): Promise<WorldDiff> {
    const base = this.marks.get(from);
    if (!base) throw new SpartaHttpError(404, `mark ${from} not found`, "/diff");
    const before = JSON.parse(base) as { tickets: Ticket[]; comments: [number, TicketComment[]][]; refunds: Refund[] };
    const beforeTickets = new Map(before.tickets.map((t) => [t.id, t]));
    const beforeCommentIds = new Set(before.comments.flatMap(([, cs]) => cs.map((c) => c.id)));
    const beforeRefunds = new Set(before.refunds.map((r) => r.id));
    const updatedTickets = [...this.s.tickets.values()].filter((t) => JSON.stringify(t) !== JSON.stringify(beforeTickets.get(t.id)));
    const newComments = [...this.s.comments.entries()].flatMap(([ticket_id, cs]) => cs.filter((c) => !beforeCommentIds.has(c.id)).map((c) => ({ ...c, ticket_id })));
    const newRefunds = this.s.refunds.filter((r) => !beforeRefunds.has(r.id));
    return {
      created: { refunds: newRefunds as unknown as Record<string, unknown>[], zendesk_comments: newComments as unknown as Record<string, unknown>[] },
      updated: { zendesk_tickets: updatedTickets as unknown as Record<string, unknown>[] },
      before: { zendesk_tickets: updatedTickets.map((t) => beforeTickets.get(t.id)) as unknown as Record<string, unknown>[] },
      money: { usd: { refunds_created: newRefunds.reduce((a, r) => a + r.amount, 0) } },
    };
  }
  async destroy() {}

  private snapshot(): string {
    return JSON.stringify({ tickets: [...this.s.tickets.values()], comments: [...this.s.comments.entries()], refunds: this.s.refunds });
  }
}
