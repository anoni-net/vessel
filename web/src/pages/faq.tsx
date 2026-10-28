import { useEffect, useRef } from "preact/hooks";
import { useCtx } from "../context.ts";
import type { MessageKey } from "../i18n/index.ts";

const GROUPS = {
  start: ["invite", "cost", "lost", "number", "share"],
  setup: ["protocols", "maker", "app", "disguise", "ios", "androidVpn", "twoDevices", "newPhone", "filter", "noTraffic", "trouble", "speed", "cities"],
  rules: ["expire", "expired", "quota", "p2p"],
  privacy: ["see", "anomaly", "law", "cloudflare", "delete"],
} as const;

type Question = (typeof GROUPS)[keyof typeof GROUPS][number];

// the home page shows these; the rest are on /faq/
const ON_HOME: Question[] = ["invite", "cost", "protocols", "app", "ios", "lost", "twoDevices", "newPhone", "noTraffic", "expire", "quota", "see"];

// /faq/#q-protocols opens that answer; the device setup links to it
export const faqAnchor = (id: Question) => `q-${id}`;

function Questions({ ids }: { ids: readonly Question[] }) {
  const { t } = useCtx();
  const target = typeof location === "undefined" ? "" : location.hash.slice(1);
  return (
    <div class="faq">
      {ids.map((id) => (
        <details class="faq__item" id={faqAnchor(id)} open={target === faqAnchor(id)}>
          <summary>{t[`faq.${id}.q` as MessageKey]}</summary>
          <p>{t[`faq.${id}.a` as MessageKey]}</p>
        </details>
      ))}
    </div>
  );
}

export function HomeFaq() {
  const { t, href } = useCtx();
  return (
    <section id="faq" class="band band--grey">
      <div class="wrap">
        <h2>{t["faq.title"]}</h2>
        <div class="faq-layout">
          <div>
            <Questions ids={ON_HOME} />
            <p class="faq__more"><a class="strong" href={href("/faq/")}>{t["faq.all"]}</a></p>
          </div>
          <FaqArt />
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  const { t, href } = useCtx();
  // a link to one question opens it; hydrating the prerendered page keeps the closed state, so open it here
  useEffect(() => {
    const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    if (target instanceof HTMLDetailsElement) target.open = true;
  }, []);
  return (
    <section class="wrap faq-page">
      <h1>{t["faq.title"]}</h1>
      {(Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map((g) => (
        <section>
          <h2>{t[`faq.group.${g}`]}</h2>
          <Questions ids={GROUPS[g]} />
        </section>
      ))}
      <p class="faq__more"><a class="strong" href={href("/feedback/?from=faq")}>{t["feedback.notAnswered"]}</a></p>
    </section>
  );
}

// Beside the questions where there is room: a cross-section of a connection (src/faq-art.ts), with the layer
// names and the legend in HTML so they are translated. Decoration only, loaded after the page is up.
const ROOM = "(min-width: 1100px)";
const LAYER_NAMES = ["faqArt.device", "faqArt.isp", "faqArt.node", "faqArt.site"] as const;
const LEGEND = [
  ["dest", "faqArt.legend.dest"],
  ["you", "faqArt.legend.you"],
  ["node", "faqArt.legend.node"],
  ["account", "faqArt.legend.account"],
] as const;

function FaqArt() {
  const { t } = useCtx();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!window.matchMedia(ROOM).matches || !canvas.current) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => {
      import("../faq-art.ts").then((m) => {
        if (!cancelled && canvas.current) stop = m.start(canvas.current, { reduced });
      }).catch(() => {});
    }, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stop?.();
    };
  }, []);
  return (
    <aside class="faq-art" aria-hidden="true">
      <div class="faq-art__stage">
        <canvas ref={canvas} />
        {LAYER_NAMES.map((key, i) => (
          // positioned by class: the CSP blocks style attributes in the prerendered HTML
          <span class={`faq-art__label faq-art__label--${i}`}>{t[key]}</span>
        ))}
      </div>
      <ul class="faq-art__legend">
        {LEGEND.map(([kind, key]) => (
          <li><span class={`faq-art__swatch faq-art__swatch--${kind}`} />{t[key]}</li>
        ))}
      </ul>
    </aside>
  );
}
