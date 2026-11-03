import { useCtx } from "../context.ts";
import { useEffect, useRef, useState } from "preact/hooks";
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
    </>
  );
}

const WIDE = "(min-width: 960px)";
// the map seen from above at a slant: a cell is A wide, its row D deep on screen, and each row north shifts B right
const A = 10;
const B = 3;
const D = 7.5;

/** Beside 社群架設的原因 on a wide screen: East and Southeast Asia as a tabletop seen from above at a slant, the land in
 * tiles, Taiwan raised in cobalt blocks, a server tower at each city with a node, and a dashed arc from Taiwan to
 * each. No words: the text beside it says what the service is. The grid is loaded only when the map is shown, so a
 * phone does not fetch it. */
function RegionMap() {
  const [map, setMap] = useState<typeof import("../region-map.ts") | null>(null);
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
  if (!map) return <div class="region-map" aria-hidden="true" />;
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
  const TOWER = 110;
  // north first, so what is nearer covers what is behind it
  const taiwan = [...map.TAIWAN].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const [oc, or] = map.ORIGIN;
  const [ox, oy] = P(oc + 0.5, or + 0.5, HOME);
  const width = map.LAND[0].length * A + rows * B;
  return (
    <div class="region-map" aria-hidden="true">
      <svg viewBox={`-4 ${-TOWER - 20} ${width + 8} ${rows * D + TOWER + 24}`}>
        <path class="region-map__land" d={land} />
        {taiwan.map(([c, r]) => box(c, r, 1, 1, HOME, "region-map__home"))}
        {[...map.NODES].sort((a, b) => a[1] - b[1]).map(([c, r]) => {
          const [tx, ty] = P(c + 0.5, r - 0.5, TOWER);
          // an arc from Taiwan up and over to the top of the tower
          const [mx, my] = [(ox + tx) / 2, Math.min(oy, ty) - Math.hypot(tx - ox, ty - oy) * 0.28];
          return (
            <>
              <path class="region-map__line" d={`M${ox} ${oy}Q${mx} ${my} ${tx} ${ty}`} />
              {box(c - 1, r - 2, 3, 3, TOWER, "region-map__node")}
              {[0.2, 0.35, 0.5, 0.65, 0.8].map((k) => (
                <path class="region-map__slot" d={`M${poly(P(c - 0.6, r + 1, TOWER * k), P(c + 1.6, r + 1, TOWER * k)).replace(" ", "L")}`} />
              ))}
            </>
          );
        })}
      </svg>
    </div>
  );
}
