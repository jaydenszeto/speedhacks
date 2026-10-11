/** Drawn SVG icons — one consistent 1.5px stroke family, currentColor so CSS owns the hue. No unicode glyphs. */

export function IconStar({ size = 16, filled = true }: { size?: number; filled?: boolean }) {
  // A five-point star. Filled for earned, hairline outline for lost — same silhouette either way.
  const d = "M12 3.2 L14.47 8.46 L20.2 9.2 L16 13.2 L17.1 19 L12 16.2 L6.9 19 L8 13.2 L3.8 9.2 L9.53 8.46 Z";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={filled ? 0 : 1.4} strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function IconFlag({ size = 14 }: { size?: number }) {
  // A pennant on a staff — the trip marker.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 21 V4" />
      <path d="M6 4.5 H17.5 L14.5 9 L17.5 13.5 H6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconClose({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M6 6 L18 18 M18 6 L6 18" />
    </svg>
  );
}

export function IconArrow({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none" }}>
      <path d="M5 12 H19 M13 6 L19 12 L13 18" />
    </svg>
  );
}
