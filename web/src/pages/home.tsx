import { useCtx } from "../context.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { useInView } from "./in-view.ts";
import { looksSignedIn, useSignedIn } from "../session.ts";
import { HomeFaq } from "./faq.tsx";
import { Icon, type IconName } from "../icons.tsx";
import { BlockTitle } from "./block-title.tsx";
import { HeroFigure, HowItWorks } from "./hero-figure.tsx";
import { SectionHead } from "./section-head.tsx";

const STEPS = ["1", "2", "3"] as const;
// the first three on every screen, the fourth too where the cards sit two to a row, all six on a wide screen (styles.css)
const WHEN = ["1", "2", "3", "4", "5", "6"] as const;
// public Wi-Fi, travel, a blocked site, scam sites, ads and trackers, the carrier's network
const WHEN_ICON: Record<(typeof WHEN)[number], IconName> = {
  "1": "wifi", "2": "travel", "3": "blocked", "4": "phishing", "5": "trackers", "6": "carrier",
};
// 三個語系的 when.note 都寫了這個產品名，連結就放在它上面
const TOR_BROWSER = "Tor Browser";

export function Home() {
  const { t, href } = useCtx();
  const [torBefore, torAfter = ""] = t["when.note"].split(TOR_BROWSER);
  const signedIn = useSignedIn();
  return (
    <>
      <section class="hero band band--tint">
        <div class="wrap hero__inner">
          <div class="hero__text">
            <h1 class="hero__title"><BlockTitle /><span class="sr-only">{t["home.title"]}</span></h1>
            <p class="lead">{t["home.lead"]}</p>
            <p class="strong">{t["home.promise"]}</p>
            <p><a href={href("/learn/")}>{t["learn.link"]}</a></p>
            {looksSignedIn(signedIn) ? (
              <div class="actions">
                <a class="nb-button nb-button--primary" href={href("/devices/")}>{t["home.devices"]}</a>
              </div>
            ) : (
              // not known yet: keep the space, show nothing (see session.ts)
              <div class={`hero__cta${signedIn === null ? " is-pending" : ""}`} aria-hidden={signedIn === null ? "true" : undefined}>
                <div class="actions">
                  <a class="nb-button nb-button--primary" href={href("/redeem/")} tabIndex={signedIn === null ? -1 : undefined}>{t["home.invite"]}</a>
                  <a class="nb-button" href={href("/login/")} tabIndex={signedIn === null ? -1 : undefined}>{t["home.login"]}</a>
                </div>
                {/* the state of the service where a visitor decides whether to go on: invited only, and still a test */}
                <p class="muted hero__status"><span class="pill">{t["home.badge"]}</span>{t["home.inviteOnly"]}</p>
              </div>
            )}
          </div>
          <HeroFigure />
        </div>
      </section>

      <section id="when" class="band">
        <div class="wrap">
          <SectionHead title={t["when.title"]} en="Use cases" />
          <ul class="cards cards--3 cards--six plain">
            {WHEN.map((n) => (
              <li class={n === "4" ? "card card--fourth" : Number(n) > 4 ? "card card--wide" : "card"}>
                <div class="card__head">
                  <span class="card__icon"><Icon name={WHEN_ICON[n]} /></span>
                  <h3>{t[`when.${n}.title`]}</h3>
                </div>
                <p>{t[`when.${n}.body`]}</p>
              </li>
            ))}
          </ul>
          <p class="note">
            {torBefore}<a href="https://www.torproject.org/" target="_blank" rel="noopener">{TOR_BROWSER}</a>{torAfter}
          </p>
        </div>
      </section>

      <section id="works" class="band">
        <div class="wrap">
          <SectionHead title={t["works.title"]} en="How it works" />
          <HowItWorks />
        </div>
      </section>

      <section id="how" class="band band--grey">
        <div class="wrap">
          <SectionHead title={t["how.title"]} en="3 steps" />
          <ol class="cards cards--3">
            {STEPS.map((n) => (
              <li class="card">
                <span class="step" aria-hidden="true">{n}</span>
                <h3>{t[`how.${n}.title`]}</h3>
                <p>{t[`how.${n}.body`]}</p>
                {n === "2" && <p class="small"><a href={href("/dns/")}>{t["dns.link"]}</a></p>}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="why" class="band">
        <div class="wrap why-layout">
          <div>
            <SectionHead title={t["why.title"]} en="Why" />
            <p class="section-lead">{t["why.body"]}</p>
            <p class="section-lead">{t["why.reach"]}</p>
            <div class="actions">
              <a class="nb-button" href={href("/feedback/?from=home")}>{t["feedback.link"]}</a>
              <a class="nb-button" href={href("/status/")}>{t["status.title"]}</a>
            </div>
          </div>
          <RegionMap />
        </div>
      </section>

      <HomeFaq />

      {/* device inspection, which every account has: what a report tells, and a made-up one to look through first */}
      <section id="inspect" class="band band--grey">
        <div class="wrap">
          <SectionHead title={t["home.inspect.title"]} en="Inspection" />
          <p class="section-lead">{t["home.inspect.body"]}</p>
          <div class="actions">
            <a class="nb-button" href={href("/sample-report/")} data-testid="home-sample">{t["home.inspect.link"]}</a>
          </div>
        </div>
      </section>

      {/* for the few who look after a group: what a group account is, in two lines, and the page that explains it */}
      <section id="groups" class="band">
        <div class="wrap">
          <SectionHead title={t["home.groups.title"]} en="For groups" />
          <p class="section-lead">{t["home.groups.body"]}</p>
          <div class="actions">
            <a class="nb-button" href={href("/for-groups/")}>{t["home.groups.link"]}</a>
          </div>
        </div>
      </section>
    </>
  );
}

const WIDE = "(min-width: 960px)";
// the map seen from above at a slant: a cell is A wide, its row D deep on screen, and each row north shifts B right
const A = 10;
const B = 3;
const D = 7.5;

/** Beside 社群架設的原因 on a wide screen: East and Southeast Asia as a tabletop seen from above at a slant, the land in
 * tiles, Taiwan raised in cobalt blocks, a lighthouse at each city with a node, and a dashed arc from Taiwan to
 * the ones abroad. No words: the text beside it says what the service is. The grid is loaded only when the map is shown, so a
 * phone does not fetch it. */
function RegionMap() {
  const [map, setMap] = useState<typeof import("../region-map.ts") | null>(null);
  const [ref, seen] = useInView<HTMLDivElement>();
  useEffect(() => {
    const wide = matchMedia(WIDE);
    let asked = false;
    const load = () => {
      if (asked || !wide.matches) return;
      asked = true;
      import("../region-map.ts").then(setMap, () => undefined);
    };
    load();
    wide.addEventListener("change", load);
    return () => wide.removeEventListener("change", load);
  }, []);
  if (!map) return <div ref={ref} class="region-map" aria-hidden="true" />;
  const rows = map.LAND.length;
  // a point of the table: column, row, height above it
  const P = (c: number, r: number, z = 0) => [c * A + (rows - r) * B, r * D - z] as const;
  const poly = (...ps: (readonly [number, number])[]) => ps.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const tile = (c: number, r: number, z = 0, g = 0.12) =>
    `M${poly(P(c + g, r + g, z), P(c + 1 - g, r + g, z), P(c + 1 - g, r + 1 - g, z), P(c + g, r + 1 - g, z)).replaceAll(" ", "L")}Z`;
  const land = map.LAND.flatMap((row, r) => [...row].map((ch, c) => (ch === "#" ? tile(c, r) : ""))).join("");
  // a box on the table: its top, the face toward us (south) and the one to the right (east)
  const box = (c: number, r: number, w: number, d: number, h: number, cls: string) => (
    <g class={cls}>
      <polygon class="region-map__south" points={poly(P(c, r + d), P(c + w, r + d), P(c + w, r + d, h), P(c, r + d, h))} />
      <polygon class="region-map__east" points={poly(P(c + w, r + d), P(c + w, r), P(c + w, r, h), P(c + w, r + d, h))} />
      <polygon class="region-map__top" points={poly(P(c, r, h), P(c + w, r, h), P(c + w, r + d, h), P(c, r + d, h))} />
    </g>
  );
  const HOME = 10; // how high Taiwan's blocks stand
  const LIGHT = 80; // how high a lighthouse stands, to the tip of its roof
  // a lighthouse where (x, y) is the middle of its foot: a tapered tower with two bands, a lit lantern and two beams
  const lighthouse = (x: number, y: number) => {
    const [foot, top, bottom, lantern, roof] = [14, 9, y, y - 52, y - 66];
    const half = (f: number) => foot + (top - foot) * f;
    const at = (f: number) => y - 52 * f;
    const band = (from: number, to: number) =>
      `M${x - half(from)} ${at(from)}Q${x} ${at(from) + 5} ${x + half(from)} ${at(from)}L${x + half(to)} ${at(to)}Q${x} ${at(to) + 5} ${x - half(to)} ${at(to)}Z`;
    return (
      <g class="region-map__node">
        <path class="region-map__beam" d={`M${x} ${lantern - 7}L${x - 78} ${lantern - 25}V${lantern + 11}ZM${x} ${lantern - 7}L${x + 78} ${lantern - 25}V${lantern + 11}Z`} />
        <ellipse class="region-map__rock" cx={x} cy={bottom} rx={20} ry={7} />
        <path class="region-map__tower" d={`M${x - foot} ${bottom}L${x - top} ${lantern}H${x + top}L${x + foot} ${bottom}Q${x} ${bottom + 6} ${x - foot} ${bottom}Z`} />
        <path class="region-map__band" d={band(0.24, 0.44)} />
        <path class="region-map__band" d={band(0.64, 0.84)} />
        <ellipse class="region-map__tower" cx={x} cy={lantern} rx={top + 4} ry={3.5} />
        <rect class="region-map__lantern" x={x - 6.5} y={roof} width={13} height={14} />
        <path class="region-map__roof" d={`M${x - 8.5} ${roof}L${x} ${y - LIGHT}L${x + 8.5} ${roof}Z`} />
      </g>
    );
  };
  // north first, so what is nearer covers what is behind it
  const taiwan = [...map.TAIWAN].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const [oc, or] = map.ORIGIN;
  const [ox, oy] = P(oc + 0.5, or + 0.5, HOME);
  const width = map.LAND[0].length * A + rows * B;
  return (
    <div ref={ref} class={`region-map${seen ? " region-map--live" : ""}`} aria-hidden="true">
      <svg viewBox={`-4 ${-LIGHT - 20} ${width + 8} ${rows * D + LIGHT + 24}`}>
        <path class="region-map__land" d={land} />
        {taiwan.map(([c, r]) => box(c, r, 1, 1, HOME, "region-map__home"))}
        {[...map.NODES].sort((a, b) => a[1] - b[1]).map(([c, r]) => {
          // a node on Taiwan itself stands on the raised blocks, and needs no line to reach it
          const near = Math.hypot(c - oc, r - or) < 6;
          const [x, y] = P(c + 0.5, r + 0.5, near ? HOME : 0);
          const [tx, ty] = [x, y - LIGHT];
          // an arc from Taiwan up and over to the tip of the lighthouse
          const [mx, my] = [(ox + tx) / 2, Math.min(oy, ty) - Math.hypot(tx - ox, ty - oy) * 0.28];
          return (
            <>
              {!near && <path class="region-map__line" d={`M${ox} ${oy}Q${mx} ${my} ${tx} ${ty}`} />}
              {lighthouse(x, y)}
            </>
          );
        })}
      </svg>
    </div>
  );
}
