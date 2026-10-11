import type { FleetIntel, Health, RunStatus, Scenario, Trip, AgentEvent } from "./types";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetch("/api/health").then(j<Health>),
  scenario: () => fetch("/api/scenario").then(j<Scenario>),
  startRun: (body: { runner?: string; stepMs?: number } = {}) =>
    fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(j<{ runId: string; phase: string }>),
  stopRun: () => fetch("/api/runs/stop", { method: "POST" }).then(j<{ ok: boolean }>),
  current: () => fetch("/api/runs/current").then(j<RunStatus>),
  trip: (id: string) => fetch(`/api/trips/${id}`).then(j<{ trip: Trip; chain: AgentEvent[] }>),
  fleet: () => fetch("/api/fleet").then(j<FleetIntel>),
};
