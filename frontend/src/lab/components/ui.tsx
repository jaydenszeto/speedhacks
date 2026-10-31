/** Small shared pieces: section frame, verdict chip, animated counter, the mark. */
import { animate, motion, useInView, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import type { Verdict } from "../types";

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Where an expected (non-leak) finding went, in words: loopback stays inside the sandbox; anything else is the listing's own service. */
export function expectedWhere(destination: string): string {
  const h = destination.replace(/\s*\(TLS\)$/, "").toLowerCase().replace(/^\[([^\]]+)\].*$/, "$1").replace(/:\d+$/, "");
  return h === "localhost" || h === "::1" || h === "0.0.0.0" || /^127(\.\d{1,3}){3}$/.test(h) ? "localhost, inside the sandbox" : "its own declared service";
}

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="5" fill="#C62A14" />
    </svg>
  );
}

export function Section({ id, num, title, cap, aside, children }: {
  id: string; num: string; title: ReactNode; cap: ReactNode; aside?: ReactNode; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const seen = useInView(ref, { once: true, margin: "-15% 0px" });
  return (
    <section id={id} ref={ref} className="sec" aria-labelledby={`${id}-t`}>
      <div className="wrap">
        <motion.header
          className="sec__head"
          initial={{ opacity: 0, y: 16 }}
          animate={seen ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE_OUT }}
        >
          <div>
            <span className="sec__num" aria-hidden="true">{num}</span>
            <h2 className="sec__title" id={`${id}-t`}>{title}</h2>
            <p className="sec__cap">{cap}</p>
          </div>
          <div className="sec__aside">{aside}</div>
        </motion.header>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={seen ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.9, delay: 0.12, ease: EASE_OUT }}
        >
          {children}
        </motion.div>
      </div>
    </section>
  );
}

export function VerdictChip({ verdict }: { verdict?: Verdict | "untested" | "running" }) {
  if (!verdict || verdict === "untested") return <span className="chip">untested</span>;
  if (verdict === "running") return <span className="chip"><span className="dot dot--on" /> on trial</span>;
  return <span className={`chip chip--${verdict}`}>{verdict}</span>;
}

/** Counts up to `value` when it changes. Tabular, so the layout never jitters. */
export function Counter({ value, className }: { value: number; className?: string }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    const c = animate(mv, value, { duration: 1.1, ease: EASE_OUT });
    return () => c.stop();
  }, [mv, value]);
  return <motion.span className={className}>{text}</motion.span>;
}

export const ms = (n?: number) => (n === undefined ? "—" : n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(1)}s`);
export const ago = (iso?: string) => {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}
