import { useCtx } from "../context.ts";
import type { Locale, MessageKey } from "../i18n/index.ts";
import { COMMUNITY_SITE, LOCALE_PATH } from "../site.ts";

// Group accounts for the people who would ask for one: who they suit, what a leader can do and see, and how
// to ask (toomore/anoni-net-ws#488). A group needs a way to be reached, since the leaders' invite codes are
// handed over in person, so asking goes through the feedback page or email, never the portal's database.
const LEADER = [1, 2, 3, 4] as const;
const SEES = [1, 2, 3] as const;
const APPLY = [1, 2, 3] as const;
const contact = (l: Locale) => `${COMMUNITY_SITE}${LOCALE_PATH[l]}/contact/`;

const SECTIONS = ["who", "leader", "member", "sees", "terms", "apply"] as const;

export function ForGroups() {
  const { t, href, locale } = useCtx();
  return (
    <section class="wrap narrow stack learn">
      <h1>{t["forGroups.title"]}</h1>
      <p class="lead">{t["forGroups.lead"]}</p>
      <p class="muted">{t["forGroups.trial"]}</p>

      <div class="learn-layout">
        <nav class="learn-toc" aria-label={t["learn.toc"]} data-testid="learn-toc">
          <p class="learn-toc__title">{t["learn.toc"]}</p>
          <ul class="plain">
            {SECTIONS.map((id) => <li><a href={`#for-groups-${id}`}>{t[`forGroups.${id}.title`]}</a></li>)}
          </ul>
        </nav>
        <div class="learn-body">
      <h2 id="for-groups-who">{t["forGroups.who.title"]}</h2>
      <p>{t["forGroups.who.body"]}</p>

      <h2 id="for-groups-leader">{t["forGroups.leader.title"]}</h2>
      <ul>
        {LEADER.map((n) => <li>{t[`forGroups.leader.${n}` as MessageKey]}</li>)}
      </ul>
      <p>{t["forGroups.leader.two"]}</p>

      <h2 id="for-groups-member">{t["forGroups.member.title"]}</h2>
      <p>{t["forGroups.member.body"]}</p>

      <h2 id="for-groups-sees">{t["forGroups.sees.title"]}</h2>
      <p>{t["forGroups.sees.body"]}</p>
      <h3>{t["forGroups.sees.yes"]}</h3>
      <ul>
        {SEES.map((n) => <li>{t[`forGroups.sees.yes.${n}` as MessageKey]}</li>)}
      </ul>
      <h3>{t["forGroups.sees.no"]}</h3>
      <ul>
        {SEES.map((n) => <li>{t[`forGroups.sees.no.${n}` as MessageKey]}</li>)}
      </ul>
      <p>{t["forGroups.sees.inspect"]}</p>
      <p class="small"><a href={href("/privacy/#groups")}>{t["forGroups.sees.link"]}</a></p>

      <h2 id="for-groups-terms">{t["forGroups.terms.title"]}</h2>
      <p>{t["forGroups.terms.body"]}</p>
      <p>{t["forGroups.terms.end"]}</p>

      <h2 id="for-groups-apply">{t["forGroups.apply.title"]}</h2>
      <ol>
        {APPLY.map((n) => <li>{t[`forGroups.apply.${n}` as MessageKey]}</li>)}
      </ol>
      <div class="actions">
        <a class="nb-button nb-button--primary" href={href("/feedback/?from=groups")}>{t["forGroups.apply.button"]}</a>
      </div>
      <p>{t["forGroups.apply.other"]}</p>
      <p class="small"><a href={contact(locale)} target="_blank" rel="noopener">{t["learn.contactLink"]}</a></p>
        </div>
      </div>
    </section>
  );
}
