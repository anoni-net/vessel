// Small moving parts for the devices page, for people who keep it open: numbers that count up to their new value,
// a "+12 MB" that shows what the last read added, and a ring that fills until the next read. Everything here works
// from what the page already shows; nothing new is asked of the server or kept anywhere.
import { useEffect, useRef, useState } from "preact/hooks";

const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** `value`, counting from the one before over `ms`; with reduced motion, `value` at once. */
export function useTween(value: number, ms = 900): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || calm()) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      // ease-out: quick at first, settling on the value
      const v = start + (value - start) * (1 - (1 - k) ** 3);
      from.current = v;
      setShown(v);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown;
}

/** What the last read added to a card, pinned to its top edge so nothing in the card moves. It stays until `until`,
 * when the page asks for the next read, and fades out just before. Give it a `key` that changes with every read, so
 * the same amount read twice in a row shows again. */
export function Added({ items, until }: { items: string[]; until: number }) {
  // from when this read's chips appeared, so a re-render does not move the fade
  const shownAt = useRef(Date.now());
  if (items.length === 0) return null;
  const out = Math.max(6_000, until - shownAt.current - FADE_MS);
  return (
    <span class="added" aria-hidden="true" style={{ animationDelay: `0ms, ${out}ms` }}>
      {items.map((x) => <span class="added__item">{x}</span>)}
    </span>
  );
}
const FADE_MS = 1_000;

/** A ring that fills from the last read until `dueAt`, when the page asks again. */
export function NextRead({ from, dueAt, label }: { from: number; dueAt: number; label: string }) {
  const span = Math.max(1, dueAt - from);
  const done = Math.min(span, Math.max(0, Date.now() - from));
  return (
    <span class="next-read">
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <circle class="next-read__track" cx="10" cy="10" r="7.5" />
        {/* a negative delay starts the fill where it would be now; `key` restarts it after each read */}
        <circle key={from} class="next-read__fill" cx="10" cy="10" r="7.5" pathLength={100}
          style={{ animationDuration: `${span}ms`, animationDelay: `-${done}ms` }} />
      </svg>
      {/* in words beside the ring, not in a tooltip that a keyboard or a finger cannot open */}
      <span>{label}</span>
    </span>
  );
}
