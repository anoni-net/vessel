import { useCtx } from "../context.ts";
import { useEffect, useRef } from "preact/hooks";
import { useSignedIn } from "../session.ts";
import { HomeFaq } from "./faq.tsx";

const STEPS = ["1", "2", "3"] as const;

export function Home() {
  const { t, href, locale } = useCtx();
  const signedIn = useSignedIn();
  const [open, close] = locale === "en" ? [" (", ")"] : ["（", "）"];
  return (
    <>
      <section class="hero band band--tint">
        <div class="wrap hero__inner">
          <div class="hero__text">
            <span class="pill">{t["home.badge"]}</span>
            <h1>{t["home.title"]}</h1>
            <p class="lead">{t["home.lead"]}</p>
            {signedIn ? (
              <div class="actions">
                <a class="nb-button nb-button--primary" href={href("/devices/")}>{t["home.devices"]}</a>
              </div>
            ) : (
              <>
                <div class="actions">
                  <a class="nb-button nb-button--primary" href={href("/redeem/")}>{t["home.invite"]}</a>
                  <a class="nb-button" href={href("/login/")}>{t["home.login"]}</a>
                </div>
                <p class="muted">{t["home.inviteOnly"]}</p>
              </>
            )}
          </div>
          <HeroArt />
        </div>
      </section>

      <section id="how" class="band">
        <div class="wrap">
          <h2>{t["how.title"]}</h2>
          <ol class="cards cards--3">
            {STEPS.map((n) => (
              <li class="card">
                <span class="step" aria-hidden="true">{n}</span>
                <h3>{t[`how.${n}.title`]}</h3>
                <p>{t[`how.${n}.body`]}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="limits" class="band band--grey">
        <div class="wrap">
          <h2>{t["limits.title"]}</h2>
          <p class="section-lead">{t["limits.lead"]}</p>
          <div class="cards cards--2">
            <div class="card">
              <h3>{t["limits.can"]}</h3>
              <ul>
                <li>{t["limits.can.1"]}</li>
                <li>{t["limits.can.2"]}</li>
                <li>{t["limits.can.3"]}</li>
                <li>{t["limits.can.4"]}{open}<a href={href("/dns/")}>{t["dns.link"]}</a>{close}</li>
              </ul>
            </div>
            <div class="card">
              <h3>{t["limits.cannot"]}</h3>
              <ul>
                <li>{t["limits.cannot.1"]}{open}<a href="https://www.torproject.org/" target="_blank" rel="noopener">torproject.org</a>{close}</li>
                <li>{t["limits.cannot.2"]}</li>
                <li>{t["limits.cannot.3"]}</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="data" class="band">
        <div class="wrap">
          <h2>{t["data.title"]}</h2>
          <div class="cards cards--2">
            <div class="card card--tint card--flat">
              <h3>{t["data.kept"]}</h3>
              <ul>
                <li>{t["data.kept.1"]}</li>
                <li>{t["data.kept.2"]}</li>
                <li>{t["data.kept.3"]}</li>
                <li>{t["data.kept.4"]}</li>
              </ul>
            </div>
            <div class="card card--flat">
              <h3>{t["data.notKept"]}</h3>
              <ul>
                <li>{t["data.notKept.1"]}</li>
                <li>{t["data.notKept.2"]}</li>
                <li>{t["data.notKept.3"]}</li>
                <li>{t["data.notKept.4"]}</li>
              </ul>
            </div>
          </div>
          <p class="note">
            {t["data.cloudflare"]}{locale === "en" ? " " : ""}{t["data.stats"]}{locale === "en" ? " " : ""}<a href={href("/privacy/")}>{t["data.details"]}</a>{locale === "en" ? "." : "。"}
          </p>
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
