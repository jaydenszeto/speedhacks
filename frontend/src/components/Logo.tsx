/** The Tripwire mark: a tripwire line crossing a boundary, snapping taut (sage calm → brick when tripped). */
export function Logo({ size = 22, tripped = false }: { size?: number; tripped?: boolean }) {
  const c = tripped ? "var(--brick)" : "var(--sage)";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10.25" stroke="var(--line-strong)" strokeWidth="1.5" />
      <path d={tripped ? "M3 15 L9 9 L13 13 L21 7" : "M3 12 H21"} stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={tripped ? 9 : 12} cy={tripped ? 9 : 12} r="2.1" fill={c} />
    </svg>
  );
}
