/**
 * RunManager owns the single active crash test and wires live inbound channels (Dial) into it. The HTTP routes and the
 * collector/webhook endpoints all talk to the current run through here.
 */
import type { Adapters } from "@tripwire/adapters";
import { TripwireRun, listPlantedCanaries } from "@tripwire/agent-harness";

export class RunManager {
  current: TripwireRun | null = null;
  private unsubscribeDial: (() => Promise<void>) | null = null;

  constructor(private adapters: Adapters) {}

  get config() { return this.adapters.config; }

  plannedCanaries() {
    const counts: Record<string, number> = {};
    for (const c of listPlantedCanaries("preview", this.adapters.config.dialCanaryNumbers)) counts[c.type] = (counts[c.type] ?? 0) + 1;
    return counts;
  }

  async startRun(opts: { runner?: "scripted" | "claude"; stepMs?: number } = {}) {
    await this.stop();
    const run = new TripwireRun(this.adapters, { runner: opts.runner ?? "scripted", stepMs: opts.stepMs ?? 650 });
    this.current = run;
    // Feed real inbound calls/SMS on canary numbers into the run as trips.
    this.unsubscribeDial = await this.adapters.dial.listen(
      (c) => { this.current?.recordDialInbound(c.to, c.kind, { from: c.from, body: c.body }); },
      () => undefined,
    ).catch(() => null);
    // Run in the background; the dashboard streams progress over SSE.
    run.start().catch(() => undefined);
    return run;
  }

  async stop() {
    if (this.unsubscribeDial) { await this.unsubscribeDial().catch(() => undefined); this.unsubscribeDial = null; }
    if (this.current) { await this.current.destroy().catch(() => undefined); }
  }

  async health() {
    const [sparta, dial, keewano] = await Promise.all([
      this.adapters.sparta.health(),
      this.adapters.dial.health(),
      this.adapters.keewano.health(),
    ]);
    return {
      ok: true,
      demoFallback: this.adapters.config.demoFallback,
      sponsors: {
        sparta: { mode: this.adapters.sparta.mode, ...sparta },
        dial: { mode: this.adapters.dial.mode, ...dial },
        keewano: { mode: this.adapters.keewano.mode, ...keewano },
        darwin: { mode: this.adapters.darwin.mode },
      },
      run: this.current?.snapshot() ?? null,
    };
  }
}
