import { useCtx } from "../context.ts";
import { GLOBE, GRID, LABELS, NODES, PATHS, PHONE, SCREEN, VIEWBOX } from "../hero-figure-data.ts";
import { DISGUISE, type Drawing, GROUP_FLOW, KEYS, LISTS, RELAY } from "../hero-figures-data.ts";
import type { MessageKey } from "../i18n/index.ts";
import { useInView } from "./in-view.ts";

// short English names under the Chinese ones: an aid in the drawing's own vernacular, left out on the English pages
const EN = { device: "YOUR DEVICE", tokyo: "NODE · TYO", taipei: "NODE · TPE", sg: "NODE · SIN", internet: "INTERNET", encrypted: "ENCRYPTED" } as const;
type Part = keyof typeof EN;

/** A label: the name in the page's language, and under it, except on the English pages, the short English one.
 * `enLine` is a second line for the English pages, where the name alone would run too long on one line. */
function Label({ x, y, anchor, name, en, enLine, note = false, on = false }: {
  x: number; y: number; anchor: "start" | "middle" | "end"; name: string; en: string; enLine?: string; note?: boolean; on?: boolean;
}) {
  const { locale } = useCtx();
  const under = locale === "en" ? enLine : en;
  return (
    <text class={`hero-fig__label${note ? " hero-fig__label--note" : ""}${on ? " hero-fig__label--on" : ""}`} x={x} y={y} text-anchor={anchor}>
      {name}
      {under && <tspan class="hero-fig__en" x={x} dy="11">{under}</tspan>}
    </text>
  );
}

function Figure({ n, viewBox, label, caption, children }: {
  n: number; viewBox: string; label: string; caption: string; children: preact.ComponentChildren;
}) {
  const [ref, seen] = useInView<HTMLElement>();
  return (
    <figure ref={ref} class={`hero-fig${seen ? " hero-fig--live" : ""}`}>
      <svg viewBox={viewBox} role="img" aria-label={label}>{children}</svg>
      <figcaption><span class="eyebrow" lang="en">FIG. 0{n}</span><span>{caption}</span></figcaption>
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
        // the English pages name the cities alone, "node" on the line under them, like the other languages' labels
        const enLine = part === "tokyo" || part === "taipei" || part === "sg" ? "NODE" : undefined;
        return <Label x={x} y={y} anchor={anchor} name={t[`hero.fig.${part}`]} en={EN[part]} enLine={enLine} note={part === "encrypted"} />;
      })}
    </Figure>
  );
}

// the words of FIG. 02 to 05 by label: the device and the internet are named as in FIG. 01
const WORDS: Record<string, MessageKey> = {
  device: "hero.fig.device", internet: "hero.fig.internet", website: "hero.fig2.website", lists: "hero.fig2.lists",
  malware: "hero.fig2.malware", phishing: "hero.fig2.phishing", scam: "hero.fig2.scam",
  inspection: "hero.fig3.inspection", plain: "hero.fig3.plain", vessel: "hero.fig3.vessel", fixed: "hero.fig3.fixed",
  ordinary: "hero.fig3.ordinary",
  tokyo: "hero.fig4.tokyo", taipei: "hero.fig4.taipei", sg: "hero.fig4.sg", exit: "hero.fig4.exit", entry: "hero.fig4.entry",
  forward: "hero.fig4.forward",
  private: "hero.fig5.private", public: "hero.fig5.public", portal: "hero.fig5.portal", noemail: "hero.fig5.noemail",
  nodek: "hero.fig5.node",
  g_member: "forGroups.flowfig.member", g_node: "forGroups.flowfig.node", g_analysis: "forGroups.flowfig.analysis",
  g_copy: "forGroups.flowfig.copy", g_deleted: "forGroups.flowfig.deleted", g_report: "forGroups.flowfig.report",
  g_summary: "forGroups.flowfig.summary", g_leader: "forGroups.flowfig.leader",
};

/** FIG. 02 to 05: fixed shapes, and labels in the page's language. */
function Drawn({ n, drawing, label, caption }: { n: number; drawing: Drawing; label: string; caption: string }) {
  const { t } = useCtx();
  return (
    <Figure n={n} viewBox={drawing.viewBox} label={label} caption={caption}>
      <g dangerouslySetInnerHTML={{ __html: drawing.shapes }} />
      {drawing.labels.map((l) => <Label x={l.x} y={l.y} anchor={l.anchor} name={t[WORDS[l.key]]} en={l.en} note={l.note} on={l.on} />)}
    </Figure>
  );
}

/** The group page's picture (pages/for-groups.tsx): where an inspection's connections go, and who gets which result. */
export function GroupFlowFigure() {
  const { t } = useCtx();
  return <Drawn n={1} drawing={GROUP_FLOW} label={t["forGroups.flowfig.label"]} caption={t["forGroups.flowfig.caption"]} />;
}

/** The hero's picture: the connection through a node. */
export const HeroFigure = Connection;

/** Under 使用情境: how Vessel does it, a picture and a few words each: the blocklists, the disguise, the relay
 * routes and the keys. Two to a row where there is room. */
export function HowItWorks() {
  const { t, href } = useCtx();
  return (
    <div class="how-it-works">
      <div class="how-it-works__item">
        <Drawn n={2} drawing={LISTS} label={t["hero.fig2.label"]} caption={t["hero.fig2.caption"]} />
        <p>{t["works.lists"]}</p>
        <p class="small"><a href={href("/dns/")}>{t["dns.link"]}</a></p>
      </div>
      <div class="how-it-works__item">
        <Drawn n={3} drawing={DISGUISE} label={t["hero.fig3.label"]} caption={t["hero.fig3.caption"]} />
        <p>{t["works.disguise"]}</p>
        <p class="small"><a href={href("/faq/#q-disguise")}>{t["faq.disguise.q"]}</a></p>
      </div>
      <div class="how-it-works__item">
        <Drawn n={4} drawing={RELAY} label={t["hero.fig4.label"]} caption={t["hero.fig4.caption"]} />
        <p>{t["works.relay"]}</p>
      </div>
      <div class="how-it-works__item">
        <Drawn n={5} drawing={KEYS} label={t["hero.fig5.label"]} caption={t["hero.fig5.caption"]} />
        <p>{t["works.keys"]}</p>
        <p class="small"><a href={href("/privacy/")}>{t["privacy.title"]}</a></p>
      </div>
    </div>
  );
}
