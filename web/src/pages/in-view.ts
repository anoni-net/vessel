import { useEffect, useRef, useState } from "preact/hooks";

/** Whether the element has come into view yet. A drawing's motion starts then, and runs for a few seconds only
 * (WCAG 2.2.2: anything that moves on its own stops within five seconds), so it plays where someone sees it. */
export function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry!.isIntersecting) return;
      setSeen(true);
      io.disconnect();
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen] as const;
}
