/** A small, consistent line-icon set for the demo — drawn SVG, 24px grid, 1.75 stroke, round joins.
 *  No unicode glyphs standing in for icons. Filled marks (play/pause/diamond) use currentColor fill. */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Play = (p: P) => (
  <Svg {...p}><path d="M7 5.5v13a1 1 0 0 0 1.52.85l10.5-6.5a1 1 0 0 0 0-1.7L8.52 4.65A1 1 0 0 0 7 5.5Z" fill="currentColor" stroke="none" /></Svg>
);
export const Pause = (p: P) => (
  <Svg {...p}><rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" /></Svg>
);
export const Replay = (p: P) => (
  <Svg {...p}><path d="M20 12a8 8 0 1 1-2.5-5.8" /><path d="M20 4v4h-4" /></Svg>
);
export const Check = (p: P) => (<Svg {...p}><path d="M5 12.5l4.2 4.2L19 6.5" /></Svg>);
export const Cross = (p: P) => (<Svg {...p}><path d="M7 7l10 10M17 7L7 17" /></Svg>);
export const Dash = (p: P) => (<Svg {...p}><path d="M6.5 12h11" /></Svg>);
export const ArrowRight = (p: P) => (<Svg {...p}><path d="M5 12h13M12.5 6l6 6-6 6" /></Svg>);
export const ArrowDown = (p: P) => (<Svg {...p}><path d="M12 5v13M6 12.5l6 6 6-6" /></Svg>);
export const Diamond = (p: P) => (
  <Svg {...p}><path d="M12 3.2 20.8 12 12 20.8 3.2 12Z" fill="currentColor" stroke="none" /></Svg>
);
export const Stop = (p: P) => (
  <Svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" /></Svg>
);
export const Bolt = (p: P) => (<Svg {...p}><path d="M13 3 4 14h6l-1 7 9-11h-6l1-7Z" fill="currentColor" stroke="none" /></Svg>);
