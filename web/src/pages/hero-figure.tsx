import { useEffect, useState } from "preact/hooks";
import { useCtx } from "../context.ts";
import { GLOBE, GRID, LABELS, NODES, PATHS, PHONE, SCREEN, VIEWBOX } from "../hero-figure-data.ts";
import { DISGUISE, type Drawing, LISTS } from "../hero-figures-data.ts";
import { type MessageKey, fmt } from "../i18n/index.ts";

// short English names under the Chinese ones: an aid in the drawing's own vernacular, left out on the English pages
const EN = { device: "YOUR DEVICE", tokyo: "NODE · TYO", sg: "NODE · SIN", internet: "INTERNET", encrypted: "ENCRYPTED" } as const;
type Part = keyof typeof EN;
// how long each picture stays before the next one
const ROTATE_EVERY = 7000;

/** A label: the name in the page's language, and under it, except on the English pages, the short English one. */
function Label({ x, y, anchor, name, en, note = false, on = false }: {
  x: number; y: number; anchor: "start" | "middle" | "end"; name: string; en: string; note?: boolean; on?: boolean;
}) {
  const { locale } = useCtx();
  return (
    <text class={`hero-fig__label${note ? " hero-fig__label--note" : ""}${on ? " hero-fig__label--on" : ""}`} x={x} y={y} text-anchor={anchor}>
      {name}
      {locale !== "en" && <tspan class="hero-fig__en" x={x} dy="11">{en}</tspan>}
    </text>
  );
}

function Figure({ n, viewBox, label, caption, children }: {
  n: number; viewBox: string; label: string; caption: string; children: preact.ComponentChildren;
}) {
  return (
    <figure class="hero-fig">
      <svg viewBox={viewBox} role="img" aria-label={label}>{children}</svg>
      <figcaption><span class="eyebrow">FIG. 0{n}</span><span>{caption}</span></figcaption>
    </figure>
  );
}

/** FIG. 01: your device, a dashed line to each city with a node, and on to the internet. */
function Connection() {
  const { t } = useCtx();
  return (
    <Figure n={1} viewBox={VIEWBOX} label={t["hero.fig.label"]} caption={t["hero.fig.caption"]}>
      <path class="hero-fig__grid" d={GRID} />
      <polygon class="hero-fig__shadow" points={PHONE.shadow} />
      {NODES.map((n) => <polygon class="hero-fig__shadow" points={n.shadow} />)}
      <ellipse class="hero-fig__shadow" cx={GLOBE.shadow[0]} cy={GLOBE.shadow[1] + 4} rx="18" ry="7" />
      {PATHS.map((d, i) => <path class={`hero-fig__path${i === 0 ? " hero-fig__path--live" : ""}`} d={d} />)}
      <polygon class="hero-fig__solid hero-fig__top" points={PHONE.top} />
      <polygon class="hero-fig__solid hero-fig__left" points={PHONE.left} />
      <polygon class="hero-fig__solid hero-fig__right" points={PHONE.right} />
      <polygon class="hero-fig__screen" points={SCREEN} />
      {NODES.map((n) => (
        <g>
          <polygon class="hero-fig__solid hero-fig__top" points={n.top} />
          <polygon class="hero-fig__solid hero-fig__left" points={n.left} />
          <polygon class="hero-fig__solid hero-fig__right" points={n.right} />
          <path class="hero-fig__slot" d={n.slots} />
          <circle class="hero-fig__led" cx={n.led[0]} cy={n.led[1]} r="1.6" />
        </g>
      ))}
      <circle class="hero-fig__solid hero-fig__top" cx={GLOBE.c[0]} cy={GLOBE.c[1]} r={GLOBE.r} />
      <ellipse class="hero-fig__slot" cx={GLOBE.c[0]} cy={GLOBE.c[1]} rx={GLOBE.r * 0.45} ry={GLOBE.r} />
      <ellipse class="hero-fig__slot" cx={GLOBE.c[0]} cy={GLOBE.c[1]} rx={GLOBE.r} ry={GLOBE.r * 0.38} />
      <path class="hero-fig__slot" d={`M${GLOBE.c[0]},${GLOBE.c[1] - GLOBE.r} V${GLOBE.c[1] + GLOBE.r}`} />
      {(Object.keys(EN) as Part[]).map((part) => {
        const [x, y, anchor] = LABELS[part] as [number, number, "start" | "middle" | "end"];
        return <Label x={x} y={y} anchor={anchor} name={t[`hero.fig.${part}`]} en={EN[part]} note={part === "encrypted"} />;
      })}
    </Figure>
  );
}

// the words of FIG. 02 and 03 by label: the device and the internet are named as in FIG. 01
const WORDS: Record<string, MessageKey> = {
  device: "hero.fig.device", internet: "hero.fig.internet", website: "hero.fig2.website", lists: "hero.fig2.lists",
  malware: "hero.fig2.malware", phishing: "hero.fig2.phishing", scam: "hero.fig2.scam",
  inspection: "hero.fig3.inspection", plain: "hero.fig3.plain", vessel: "hero.fig3.vessel", fixed: "hero.fig3.fixed",
  ordinary: "hero.fig3.ordinary",
};

/** FIG. 02 and 03: fixed shapes, and labels in the page's language. */
function Drawn({ n, drawing, label, caption }: { n: number; drawing: Drawing; label: string; caption: string }) {
  const { t } = useCtx();
  return (
    <Figure n={n} viewBox={drawing.viewBox} label={label} caption={caption}>
      <g dangerouslySetInnerHTML={{ __html: drawing.shapes }} />
      {drawing.labels.map((l) => <Label x={l.x} y={l.y} anchor={l.anchor} name={t[WORDS[l.key]]} en={l.en} note={l.note} on={l.on} />)}
    </Figure>
  );
}

/** The home page's hero pictures: the connection, the blocklists and the disguise, one after another. The next
 * comes every few seconds, holding while the pointer or the keyboard is on them; choosing one stops the turning, and
 * with prefers-reduced-motion they turn only when chosen. */
export function HeroFigure() {
  const { t } = useCtx();
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const [chosen, setChosen] = useState(false);
  const slides = [
    <Connection />,
    <Drawn n={2} drawing={LISTS} label={t["hero.fig2.label"]} caption={t["hero.fig2.caption"]} />,
    <Drawn n={3} drawing={DISGUISE} label={t["hero.fig3.label"]} caption={t["hero.fig3.caption"]} />,
  ];
  const captions = [t["hero.fig.caption"], t["hero.fig2.caption"], t["hero.fig3.caption"]];
  useEffect(() => {
    if (held || chosen || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => document.visibilityState === "visible" && setAt((x) => (x + 1) % slides.length), ROTATE_EVERY);
    return () => clearInterval(id);
  }, [held, chosen]);
  return (
    <div class="hero-figs" role="group" aria-roledescription={t["hero.figs.role"]} aria-label={t["hero.figs.label"]}
      onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
      onFocusIn={() => setHeld(true)} onFocusOut={() => setHeld(false)}>
      <div class="hero-figs__stage">
        {slides.map((slide, n) => (
          <div class={`hero-figs__slide${n === at ? " hero-figs__slide--on" : ""}`} aria-hidden={n === at ? undefined : "true"}
            inert={n === at ? undefined : true}>
            {slide}
          </div>
        ))}
      </div>
      <div class="hero-figs__pick">
        {slides.map((_, n) => (
          <button type="button" class="hero-figs__dot" aria-pressed={n === at}
            aria-label={fmt(t["hero.figs.show"], { n: n + 1, caption: captions[n] })}
            onClick={() => { setAt(n); setChosen(true); }}>
            0{n + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
