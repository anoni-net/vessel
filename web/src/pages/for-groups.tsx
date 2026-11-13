import { useCtx } from "../context.ts";
import type { Locale } from "../i18n/index.ts";
import { COMMUNITY_SITE, LOCALE_PATH } from "../site.ts";
import { SectionHead } from "./section-head.tsx";

// Group accounts, introduced to the people who would ask for one (toomore/anoni-net-ws#488): what a group gets,
// the groups it suits, device inspection and how to ask. Laid out like the home page, in bands of cards; what
// leaders can see is said once, with the policy one link away. A group needs a way to be reached, since the
// leaders' invite codes are handed over in person, so asking goes through the feedback page or email.
const FEATURES = ["1", "2", "3", "4", "5", "6"] as const;
const WHO = ["1", "2", "3"] as const;
// when asking a member to inspect a device is worth it (toomore/anoni-net-ws#483); off until a group asks for it
const INSPECT_WHEN = ["1", "2", "3", "4"] as const;
const APPLY = ["1", "2", "3"] as const;
const contact = (l: Locale) => `${COMMUNITY_SITE}${LOCALE_PATH[l]}/contact/`;

export function ForGroups() {
  const { t, href, locale } = useCtx();
  return (
    <>
      <section class="band band--tint">
        <div class="wrap">
          <div class="hero__text">
            <h1>{t["forGroups.title"]}</h1>
            <p class="lead">{t["forGroups.lead"]}</p>
            <p class="strong">{t["forGroups.promise"]}</p>
            <div class="actions">
              <a class="nb-button nb-button--primary" href="#apply">{t["forGroups.cta"]}</a>
            </div>
            <p class="muted">{t["forGroups.trial"]}</p>
          </div>
        </div>
      </section>

      <section id="features" class="band">
        <div class="wrap">
          <SectionHead title={t["forGroups.features.title"]} en="Features" />
          <ul class="cards cards--3 cards--six plain">
            {FEATURES.map((n) => (
              <li class="card">
                <h3>{t[`forGroups.feature.${n}.title`]}</h3>
                <p>{t[`forGroups.feature.${n}.body`]}</p>
                {n === "6" && <p class="small"><a href={href("/privacy/#groups")}>{t["forGroups.sees.link"]}</a></p>}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="who" class="band band--grey">
        <div class="wrap">
          <SectionHead title={t["forGroups.who.title"]} en="Who it suits" />
          <ul class="cards cards--3 plain">
            {WHO.map((n) => (
              <li class="card">
                <h3>{t[`forGroups.who.${n}.title`]}</h3>
                <p>{t[`forGroups.who.${n}.body`]}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="inspect" class="band">
        <div class="wrap">
          <SectionHead title={t["forGroups.inspect.title"]} en="Device check" />
          <p class="section-lead">{t["forGroups.inspect.body"]}</p>
          <ul class="cards cards--2 cards--pairs plain">
            {INSPECT_WHEN.map((n) => (
              <li class="card">
                <h3>{t[`forGroups.inspect.when.${n}.title`]}</h3>
                <p>{t[`forGroups.inspect.when.${n}.body`]}</p>
              </li>
            ))}
          </ul>
          <p class="note">{t["forGroups.inspect.note"]}</p>
        </div>
      </section>

      <section id="apply" class="band band--grey group-apply">
        <div class="wrap">
          <SectionHead title={t["forGroups.apply.title"]} en="3 steps" />
          <ol class="cards cards--3">
            {APPLY.map((n) => (
              <li class="card">
                <span class="step" aria-hidden="true">{n}</span>
                <h3>{t[`forGroups.apply.${n}.title`]}</h3>
                <p>{t[`forGroups.apply.${n}.body`]}</p>
              </li>
            ))}
          </ol>
          <div class="actions">
            <a class="nb-button nb-button--primary" href={href("/feedback/?from=groups")}>{t["forGroups.apply.button"]}</a>
            <a class="nb-button" href={contact(locale)} target="_blank" rel="noopener">{t["learn.contactLink"]}</a>
          </div>
          <p class="small">{t["forGroups.apply.other"]}</p>
        </div>
      </section>
    </>
  );
}
