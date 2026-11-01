import { useCtx } from "../context.ts";
import { useEffect, useRef } from "preact/hooks";
import { looksSignedIn, useSignedIn } from "../session.ts";
import { HomeFaq } from "./faq.tsx";
import { Icon, type IconName } from "../icons.tsx";

const STEPS = ["1", "2", "3"] as const;
// the first three on every screen; the other three only on a wide screen (styles.css)
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
            <h1>{t["home.title"]}</h1>
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
          <HeroArt />
        </div>
      </section>

      <section id="when" class="band">
        <div class="wrap">
          <h2>{t["when.title"]}</h2>
          <ul class="cards cards--3 cards--six plain">
            {WHEN.map((n) => (
              <li class={Number(n) > 3 ? "card card--wide" : "card"}>
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

      <section id="how" class="band band--grey">
        <div class="wrap">
          <h2>{t["how.title"]}</h2>
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
        <div class="wrap">
          <h2>{t["why.title"]}</h2>
          <p class="section-lead">{t["why.body"]}</p>
          <p class="section-lead">{t["why.reach"]}</p>
          <div class="actions">
            <a class="nb-button" href={href("/feedback/?from=home")}>{t["feedback.link"]}</a>
            <a class="nb-button" href={href("/status/")}>{t["status.title"]}</a>
          </div>
        </div>
      </section>

      <HomeFaq />
    </>
  );
}

// decoration only: beside the text on wide screens, under the buttons on phones; loaded after the page is
// up, and still for prefers-reduced-motion

function HeroArt() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const load = () =>
      import("../hero-art.ts").then((m) => {
        if (!cancelled && canvas.current) stop = m.start(canvas.current, { reduced });
      }).catch(() => {});
    // after the text and buttons are up
    const timer = window.setTimeout(load, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stop?.();
    };
  }, []);
  return (
    <div class="hero__art" aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}
