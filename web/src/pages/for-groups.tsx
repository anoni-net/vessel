import { useCtx } from "../context.ts";
import { type Locale, fmt } from "../i18n/index.ts";
import { COMMUNITY_SITE, LOCALE_PATH } from "../site.ts";
import { GroupFlowFigure, GroupResultsFigure } from "./hero-figure.tsx";
import { SectionHead } from "./section-head.tsx";

// Group accounts, introduced to the people who would ask for one (toomore/anoni-net-ws#488). Device traffic
// inspection (toomore/anoni-net-ws#483) leads: a group's devices may carry stalkerware without anyone noticing,
// and leaders can ask members to inspect them, once or in regular rounds. The page opens with what an inspection
// gives back, drawn as an example, then the steps, when to ask, who sees what, the rest of group accounts and how
// to ask for them, on a form of its own (pages/group-apply.tsx).
const FLOW = ["1", "2", "3", "4"] as const;
const ADHOC = ["1", "2", "3"] as const;
const REGULAR = ["1", "2", "3"] as const;
const RESULT = ["1", "2", "3", "4"] as const;
const MORE = ["1", "2", "3", "4", "5"] as const;
const APPLY = ["1", "2", "3"] as const;
const contact = (l: Locale) => `${COMMUNITY_SITE}${LOCALE_PATH[l]}/contact/`;

// The example's seven days, an hour to a digit from midnight, 0 for no traffic to 5 for the most: written by hand
// after how a phone is used. Nights are empty but for a sync or two, mornings and evenings are the busy hours, the
// VPN is off for a few hours on some days (day 2's afternoon, most of day 4), and the weekend (days 6 and 7) starts
// late and runs past midnight.
const HOURS = [
  "210000013322342123344310",
  "100000002433231002234421",
  "100200012322432133245300",
  "000000001232000001233410",
  "210000013423352423344520",
  "321000000012213122123453",
  "310000000001231012234310",
] as const;
// two hours a report would mark: a connection at 3 am on day 3, when the phone should be asleep, and one on day 5's afternoon
const MARKED = new Set(["3-3", "5-15"]);

function Example() {
  const { t } = useCtx();
  return (
    <figure class="hero-fig gi-fig">
      <div class="gi-fig__body">
        <div class="gi-tiles" role="img" aria-label={t["forGroups.fig.alt"]}>
          {HOURS.map((row, d) => (
            <div class="gi-tiles__row">
              <span class="gi-tiles__day">{fmt(t["forGroups.fig.day"], { n: d + 1 })}</span>
              {[...row].map((n, h) => <span class={`gi-tile gi-tile--${n}${MARKED.has(`${d + 1}-${h}`) ? " gi-tile--mark" : ""}`} />)}
            </div>
          ))}
        </div>
        <ul class="plain gi-verdicts">
          <li>
            <span class="gi-verdict__dot gi-verdict__dot--clean" aria-hidden="true" />
            <span class="strong">{t["forGroups.fig.dev.1"]}</span>
            <span>{t["group.inspect.verdict.clean"]}</span>
          </li>
          <li>
            <span class="gi-verdict__dot gi-verdict__dot--check" aria-hidden="true" />
            <span class="strong">{t["forGroups.fig.dev.2"]}</span>
            <span>{t["group.inspect.verdict.check"]}</span>
          </li>
          <li>
            <span class="gi-verdict__dot" aria-hidden="true" />
            <span class="strong">{t["forGroups.fig.dev.3"]}</span>
            <span>{fmt(t["group.inspect.status.active"], { day: 3, days: 7 })}</span>
          </li>
        </ul>
      </div>
      <figcaption><span class="strong">{t["forGroups.fig.label"]}</span><span class="gi-fig__caption">{t["forGroups.fig.caption"]}</span></figcaption>
    </figure>
  );
}

export function ForGroups() {
  const { t, href, locale } = useCtx();
  return (
    <>
      <section class="gi-band band band--tint gi-hero">
        <div class="wrap gi-hero__inner">
          <div class="gi-hero__text">
            <h1>{t["forGroups.headline"]}</h1>
            <p class="lead">{t["forGroups.lead"]}</p>
            <p class="strong">{t["forGroups.promise"]}</p>
            <div class="actions">
              <a class="nb-button nb-button--primary" href="#apply">{t["forGroups.cta"]}</a>
              <a class="nb-button" href={href("/sample-report/")}>{t["home.inspect.link"]}</a>
            </div>
            <p class="muted small">{t["forGroups.trial"]}</p>
          </div>
          <Example />
        </div>
      </section>

      <section id="flow" class="gi-band band">
        <div class="wrap">
          <SectionHead title={t["forGroups.flow.title"]} en="4 steps" />
          {/* where the connections go and who gets which result, drawn like the home page's pictures, beside the steps */}
          <div class="gi-flow-layout">
            <GroupFlowFigure />
            <ol class="plain gi-flow gi-flow--down">
              {FLOW.map((n) => (
                <li>
                  <span class="gi-flow__n" aria-hidden="true">{n}</span>
                  <h3>{t[`forGroups.flow.${n}.title`]}</h3>
                  <p>{t[`forGroups.flow.${n}.body`]}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section id="plan" class="gi-band band band--grey">
        <div class="wrap">
          <SectionHead title={t["forGroups.plan.title"]} en="When" />
          <p class="section-lead">{t["forGroups.plan.lead"]}</p>
          <div class="gi-split">
            <div>
              <h3 class="gi-split__title">{t["forGroups.plan.adhoc.title"]}</h3>
              <p class="muted">{t["forGroups.plan.adhoc.body"]}</p>
              <dl class="gi-rows">
                {ADHOC.map((n) => (
                  <div>
                    <dt>{t[`forGroups.plan.adhoc.${n}.title`]}</dt>
                    <dd>{t[`forGroups.plan.adhoc.${n}.body`]}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <h3 class="gi-split__title">{t["forGroups.plan.regular.title"]}</h3>
              <p class="muted">{t["forGroups.plan.regular.body"]}</p>
              <dl class="gi-rows">
                {REGULAR.map((n) => (
                  <div>
                    <dt>{t[`forGroups.plan.regular.${n}.title`]}</dt>
                    <dd>{t[`forGroups.plan.regular.${n}.body`]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      <section id="results" class="gi-band band">
        <div class="wrap">
          <SectionHead title={t["forGroups.results.title"]} en="Results" />
          <p class="section-lead">{t["forGroups.results.lead"]}</p>
          {/* the two results side by side as pages: how much each holds shows before the lists say it */}
          <div class="gi-flow-layout gi-flow-layout--flip">
            <GroupResultsFigure />
            <div class="gi-stack">
              <div>
                <h3 class="gi-split__title">{t["forGroups.results.member.title"]}</h3>
                <ul class="gi-points">
                  {RESULT.map((n) => <li>{t[`forGroups.results.member.${n}`]}</li>)}
                </ul>
              </div>
              <div>
                <h3 class="gi-split__title">{t["forGroups.results.leader.title"]}</h3>
                <ul class="gi-points">
                  {RESULT.map((n) => <li>{t[`forGroups.results.leader.${n}`]}</li>)}
                </ul>
              </div>
            </div>
          </div>
          <p class="note">
            {t["forGroups.results.note"]} <a href={href("/privacy/#groups")}>{t["forGroups.sees.link"]}</a>
          </p>
        </div>
      </section>

      <section id="more" class="gi-band band band--grey">
        <div class="wrap">
          <SectionHead title={t["forGroups.more.title"]} en="Group accounts" />
          <p class="section-lead">{t["forGroups.more.lead"]}</p>
          <dl class="gi-rows gi-rows--wide">
            {MORE.map((n) => (
              <div>
                <dt>{t[`forGroups.more.${n}.title`]}</dt>
                <dd>{t[`forGroups.more.${n}.body`]}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="apply" class="gi-band band band--tint">
        <div class="wrap">
          <SectionHead title={t["forGroups.apply.title"]} en="3 steps" />
          <ol class="plain gi-flow gi-flow--3">
            {APPLY.map((n) => (
              <li>
                <span class="gi-flow__n" aria-hidden="true">{n}</span>
                <h3>{t[`forGroups.apply.${n}.title`]}</h3>
                <p>{t[`forGroups.apply.${n}.body`]}</p>
              </li>
            ))}
          </ol>
          <div class="actions gi-actions">
            <a class="nb-button nb-button--primary" href={href("/for-groups/apply/")}>{t["forGroups.apply.button"]}</a>
            <a class="nb-button" href={contact(locale)} target="_blank" rel="noopener">{t["learn.contactLink"]}</a>
          </div>
          <p class="small gi-other">{t["forGroups.apply.other"]}</p>
        </div>
      </section>
    </>
  );
}
