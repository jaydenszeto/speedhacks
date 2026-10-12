import { useEffect, useRef, useState } from "react";

const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Adds `is-in` once the element scrolls into view. Fires once; respects reduced-motion (shows immediately). */
export function useReveal<T extends HTMLElement = HTMLDivElement>(opts: { threshold?: number; rootMargin?: string } = {}) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced()) { setShown(true); return; }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { setShown(true); io.disconnect(); break; }
        }
      },
      { threshold: opts.threshold ?? 0.2, rootMargin: opts.rootMargin ?? "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [opts.threshold, opts.rootMargin]);
  return { ref, shown };
}

/** Calls `onEnter` once when the element first enters view (used to autoplay the theater). */
export function useOnEnter<T extends HTMLElement = HTMLDivElement>(onEnter: () => void, threshold = 0.45) {
  const ref = useRef<T>(null);
  const fired = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !fired.current) { fired.current = true; onEnter(); io.disconnect(); break; }
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [onEnter, threshold]);
  return ref;
}
