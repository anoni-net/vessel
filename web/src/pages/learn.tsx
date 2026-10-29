import { useCtx } from "../context.ts";
import type { MessageKey } from "../i18n/index.ts";

// VPN basics for people who have never used one: what it does, daily use, getting ready for a trip and what
// to do when it will not connect. Written from the questions of first-time users; linked from the home page and
// the first step of creating a device.
const TRIP = [1, 2, 3, 4, 5] as const;
const TROUBLE = [1, 2, 3, 4] as const;
// 三個語系的 learn.noticed.body 都寫了這個產品名，連結就放在它上面
const TOR_BROWSER = "Tor Browser";

export function Learn() {
  const { t, href } = useCtx();
  const [torBefore, torAfter = ""] = t["learn.noticed.body"].split(TOR_BROWSER);
  return (
    <section class="wrap narrow stack learn">
      <h1>{t["learn.title"]}</h1>
      <p class="lead">{t["learn.lead"]}</p>

      <h2>{t["learn.what.title"]}</h2>
      <p>{t["learn.what.1"]}</p>
      <p>{t["learn.what.2"]}</p>

      <h2>{t["learn.daily.title"]}</h2>
      <h3>{t["learn.apps.title"]}</h3>
      <p>{t["learn.apps.body"]}</p>
      <h3>{t["learn.stream.title"]}</h3>
      <p>{t["learn.stream.body"]}</p>
      <p class="small"><a href={href("/faq/#q-splitTunnel")}>{t["faq.splitTunnel.q"]}</a></p>
      <h3>{t["learn.on.title"]}</h3>
      <p>{t["learn.on.body"]}</p>

      <h2>{t["learn.working.title"]}</h2>
      <p>{t["learn.working.body"]}</p>
      <p class="small"><a class="strong" href={href("/check/")}>{t["check.title"]}</a></p>

      <h2>{t["learn.trip.title"]}</h2>
      <ol>
        {TRIP.map((n) => <li>{t[`learn.trip.${n}` as MessageKey]}</li>)}
      </ol>

      <h2>{t["learn.trouble.title"]}</h2>
      <ol>
        {TROUBLE.map((n) => <li>{t[`learn.trouble.${n}` as MessageKey]}</li>)}
      </ol>
      <div class="actions">
        <a class="nb-button" href={href("/status/")}>{t["status.title"]}</a>
        <a class="nb-button" href={href("/feedback/?from=learn")}>{t["feedback.link"]}</a>
      </div>

      <h2>{t["learn.noticed.title"]}</h2>
      <p>
        {torBefore}<a href="https://www.torproject.org/" target="_blank" rel="noopener">{TOR_BROWSER}</a>{torAfter}
      </p>

      <h2>{t["learn.see.title"]}</h2>
      <p>{t["learn.see.body"]}</p>
      <p class="small"><a href={href("/privacy/")}>{t["privacy.title"]}</a></p>
    </section>
  );
}
