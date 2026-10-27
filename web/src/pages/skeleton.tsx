import { useCtx } from "../context.ts";

// Grey blocks in the shape of a page while its data or code loads, so the page does not jump from empty to
// full. Sizes are classes, not style attributes: these are prerendered, and the CSP blocks inline styles.

type Width = "full" | "long" | "mid" | "short";

export function SkLine({ w = "full", big = false }: { w?: Width; big?: boolean }) {
  return <span class={`sk sk--${w}${big ? " sk--big" : ""}`} />;
}

/** `size` gives the card the height of the one it stands for, so nothing moves when the data arrives. */
export function SkCard({ lines, tint = false, size }: { lines: Width[]; tint?: boolean; size?: "usage" | "device" }) {
  return (
    <div class={`card card--flat sk-card${tint ? " card--tint" : ""}${size ? ` sk-card--${size}` : ""}`}>
      {lines.map((w, i) => <SkLine w={w} big={i === 0} />)}
    </div>
  );
}

export function SkButton() {
  return <span class="sk sk--button" />;
}

/** Says "loading" to screen readers; the grey blocks are hidden from them. */
export function Busy() {
  const { t } = useCtx();
  return <p class="sr-only" role="status">{t["loading"]}</p>;
}

/** The new-device page while its code (key generation, the QR code) loads: the first step's layout. */
export function NewDeviceSkeleton() {
  return (
    <section class="wrap narrow stack" aria-busy="true">
      <div class="stack" aria-hidden="true">
        <SkLine w="short" />
        <SkLine w="long" big />
        <SkLine />
        <SkLine w="mid" />
        <SkCard lines={["long", "mid"]} />
        <SkButton />
      </div>
      <Busy />
    </section>
  );
}
