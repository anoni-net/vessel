import { useCtx } from "../context.ts";
import { GLOBE, GRID, LABELS, NODES, PATHS, PHONE, SCREEN, VIEWBOX } from "../hero-figure-data.ts";

// short English names under the Chinese ones: an aid in the drawing's own vernacular, left out on the English pages
const EN = { device: "YOUR DEVICE", tokyo: "NODE · TYO", sg: "NODE · SIN", internet: "INTERNET", encrypted: "ENCRYPTED" } as const;
type Part = keyof typeof EN;

/** The home page's hero picture: your device, a dashed line to each city with a node, and on to the internet. */
export function HeroFigure() {
  const { t, locale } = useCtx();
  const label = (part: Part) => {
    const [x, y, anchor] = LABELS[part] as [number, number, "start" | "middle" | "end"];
    const name = t[`hero.fig.${part}`];
    return (
      <text class={`hero-fig__label${part === "encrypted" ? " hero-fig__label--note" : ""}`} x={x} y={y} text-anchor={anchor}>
        {name}
        {locale !== "en" && <tspan class="hero-fig__en" x={x} dy="11">{EN[part]}</tspan>}
      </text>
    );
  };
  return (
    <figure class="hero-fig">
      <svg viewBox={VIEWBOX} role="img" aria-label={t["hero.fig.label"]}>
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
        {(Object.keys(EN) as Part[]).map(label)}
      </svg>
      <figcaption><span class="eyebrow">FIG. 01</span><span>{t["hero.fig.caption"]}</span></figcaption>
    </figure>
  );
}
