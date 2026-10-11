import type { ReactNode } from "react";

export function SeverityTag({ severity }: { severity: string }) {
  return <span className={`sev sev-${severity}`}>{severity}</span>;
}

export function Pill({ tone, children }: { tone: "live" | "tripped" | "paused" | "idle" | "done"; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="mono">{children}</span>;
}
