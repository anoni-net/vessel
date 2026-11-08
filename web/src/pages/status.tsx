import { useEffect, useState } from "preact/hooks";
import { Icon } from "../icons.tsx";
import { type Status, api } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatTime } from "../format.ts";
import { type MessageKey, fmt } from "../i18n/index.ts";
import { REACH_GROUPS, type ReachGroup, type ReachState, joinNames, troubledSites } from "../reach.ts";
import { flagOf } from "../regions.ts";
import { SkCard } from "./skeleton.tsx";

const REFRESH_EVERY = 2 * 60_000;

const HATCH = "reach-hatch";

/**
 * A slot's mark, by more than its colour (WCAG 1.4.1): the hours a site did not open stand full height, solid when it
 * could not open and hatched when it asked for a check; the hours it opened are a low bar, and those not checked the
 * outline of one.
 */
function cell(s: ReachState | null, x: number, w: number, h: number) {
  const tall = s === "blocked" || s === "challenge";
  const low = Math.round(h / 3);
  return { class: `reach-cell reach-cell--${s ?? "none"}`, x, y: tall ? 1 : 1 + h - low, width: w, height: tall ? h : low, rx: 1.5,
    fill: s === "challenge" ? `url(#${HATCH})` : undefined };
}

/** One node's last day with a site: a slot an hour, oldest on the left, each named in a title for a pointer. */
function Strip({ slots, label, ago }: { slots: (ReachState | null)[]; label: string; ago: (i: number) => string }) {
  const { t } = useCtx();
  const w = 10;
  return (
    <svg class="reach-strip" viewBox={`0 0 ${slots.length * w} 14`} preserveAspectRatio="none" role="img" aria-label={label}>
      {slots.map((s, i) => (
        <rect {...cell(s, i * w + 1, w - 2, 12)}>
          <title>{`${ago(slots.length - 1 - i)}${t["status.reach.colon"]}${t[`status.reach.state.${s ?? "none"}`]}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** The last day of the sites a node had trouble with, by the region the sites serve so readers look at the group of
 *  their own place, a row per node. A group where every node opened everything is left out. */
function ReachSection({ status, names, city }: { status: Status; names: (s: string[]) => string; city: (id: string) => string }) {
  const { t, href, locale } = useCtx();
  const history = status.reach_history ?? { hours: 24, until: "", sites: {} };
  const now = Object.fromEntries((status.reach ?? []).map((r) => [r.region, r.sites]));
  const troubled = troubledSites(history);
  const order = status.regions.map((r) => r.id);
  const groups = (Object.keys(REACH_GROUPS) as ReachGroup[]).map((group) => ({
    group, sites: (REACH_GROUPS[group] as readonly string[]).filter((s) => troubled.includes(s)),
  }));
  const shown = groups.filter((g) => g.sites.length > 0);
  const ago = (n: number) => (n === 0 ? t["status.reach.thisHour"] : fmt(t["status.reach.ago"], { n }));
  const count = (slots: (ReachState | null)[], state: ReachState) => slots.filter((s) => s === state).length;
  // when, in words, for those who cannot see the strip: the runs of hours in a state, oldest first
  const when = (slots: (ReachState | null)[], state: ReachState) => {
    const at = (i: number) => (i === slots.length - 1 ? t["status.reach.thisHourInline"] : ago(slots.length - 1 - i));
    const spans: string[] = [];
    slots.forEach((s, i) => {
      if (s !== state || slots[i - 1] === state) return;
      let end = i;
      while (slots[end + 1] === state) end++;
      // a space between Chinese and the digits of "12 小時前", none before "這一小時"
      const to = locale !== "en" && /^\d/.test(at(end)) ? ` ${at(end)}` : at(end);
      spans.push(end === i ? at(i) : fmt(t["status.reach.span"], { from: at(i), to }));
    });
    return joinNames(locale, spans);
  };
  const label = (node: string, slots: (ReachState | null)[]) => [
    fmt(t["status.reach.summary"], { node, hours: history.hours, blocked: count(slots, "blocked"), challenge: count(slots, "challenge"), ok: count(slots, "ok") }),
    ...(["blocked", "challenge"] as const).filter((s) => count(slots, s) > 0)
      .map((s) => fmt(t[`status.reach.when.${s}`], { spans: when(slots, s) })),
  ].join(t["status.reach.stop"]);
  return (
    <>
      <h2 id="reach">{t["status.reach.title"]}</h2>
      <p>{fmt(t["status.reach.lead"], { hours: history.hours })}</p>
      {shown.length === 0 ? (
        <p class="card card--dashed" data-testid="status-reach-none">{fmt(t["status.reach.allOk"], { hours: history.hours })}</p>
      ) : (
        <>
          <svg class="reach-defs" width="0" height="0" aria-hidden="true">
            <defs>
              <pattern id={HATCH} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect class="reach-hatch__base" width="4" height="4" />
                <rect class="reach-hatch__line" width="1.6" height="4" />
              </pattern>
            </defs>
          </svg>
          <div class="reach-legend small" data-testid="status-reach-legend">
            <ul class="plain">
              {(["ok", "challenge", "blocked", "none"] as const).map((s) => (
                <li>
                  <svg width="12" height="12" aria-hidden="true">
                    <rect {...cell(s === "none" ? null : s, 1, 10, 10)} />
                  </svg>
                  {t[`status.reach.state.${s}`]}
                </li>
              ))}
            </ul>
            <p class="muted">{fmt(t["status.reach.axis"], { hours: history.hours })}</p>
          </div>
          <ul class="plain status-reach" data-testid="status-reach">
            {shown.map(({ group, sites }) => (
              <li class="card card--flat" data-testid={`status-reach-${group}`}>
                <h3 class="status-reach__group">{t[`reach.group.${group}`]}</h3>
                {sites.map((site) => (
                  <div class="reach-site" data-testid={`reach-site-${site}`}>
                    <p class="strong">{names([site])}</p>
                    <ul class="plain reach-rows">
                      {order.filter((r) => history.sites[site][r]).map((r) => {
                        const slots = history.sites[site][r];
                        const node = fmt(t["status.reach.node"], { city: city(r) });
                        const current = now[r]?.[site];
                        return (
                          <li class="reach-row">
                            <span class="reach-row__node small">{node}</span>
                            <Strip slots={slots} ago={ago} label={label(node, slots)} />
                            <span class={`reach-row__now small${current === "ok" ? " muted" : ""}`}>
                              {current ? t[`status.reach.now.${current}`] : ""}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
      <details class="small status-reach-how" data-testid="status-reach-how">
        <summary>{t["status.reach.list"]}</summary>
        {groups.map(({ group }) => (
          <p><span class="strong">{t[`reach.group.${group}`]}</span>{t["status.reach.colon"]}{names([...REACH_GROUPS[group]])}</p>
        ))}
        <p>{t["status.reach.how"]}</p>
        <p>{t["status.reach.more"]}<a href={href("/feedback/?from=status")}>{t["feedback.title"]}</a>{t["status.reach.moreAfter"]}</p>
      </details>
    </>
  );
}

export function StatusPage() {
  const { t, locale, href } = useCtx();
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [at, setAt] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api.status().then(
        (s) => {
          setStatus(s);
          setFailed(false);
          setAt(new Date().toISOString());
        },
        () => setFailed(true),
      );
    load();
    const visible = () => document.visibilityState === "visible";
    const every = setInterval(() => visible() && load(), REFRESH_EVERY);
    const back = () => visible() && load();
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(every);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);

  const city = (id: string | null) => (id ? t[`region.${id}` as MessageKey] ?? id : t["status.allRegions"]);
  const when = (iso: string) => formatTime(locale, iso);
  const reach = status?.reach ?? [];
  const names = (sites: string[]) => joinNames(locale, sites.map((s) => t[`reach.site.${s}` as MessageKey] ?? s));

  return (
    <section class="wrap narrow stack status-page">
      <h1>{t["status.title"]}</h1>
      <p class="lead">{t["status.lead"]}</p>
      {failed && <p class="error" role="alert">{t["status.failed"]}</p>}

      <h2>{t["status.regions"]}</h2>
      {status ? (
        <ul class="plain status-regions" data-testid="status-regions">
          {status.regions.map((r) => (
            <li class="card">
              <div class="row">
                <span class="status-city">
                  {flagOf(r.id) && <img class="flag" src={flagOf(r.id)} alt="" width="32" height="24" />}
                  <span class="strong big">{city(r.id)}</span>
                </span>
                <span class={`badge badge--icon badge--state-${r.state}`}>
                  <Icon name={r.state === "down" ? "error" : r.state} />{t[`status.state.${r.state}`]}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        !failed && (
          <div class="status-regions">
            <SkCard lines={["long", "mid"]} />
            <SkCard lines={["long", "mid"]} />
            <SkCard lines={["long", "mid"]} />
          </div>
        )
      )}
      <p class="muted small">{t["status.how"]}</p>
      {status && reach.length > 0 && <ReachSection status={status} names={names} city={(id) => city(id)} />}

      <h2>{t["status.notices"]}</h2>
      {status && (status.notices.length === 0 ? (
        <p class="card card--dashed" data-testid="status-none">{t["status.none"]}</p>
      ) : (
        <ul class="plain status-notices" data-testid="status-notices">
          {status.notices.map((n) => (
            <li class={`card card--flat${n.ends_at ? "" : " card--tint"}`}>
              <div class="row">
                <span class="strong">{t[`status.kind.${n.kind}`]} · {city(n.region)}</span>
                {!n.ends_at && <span class="badge">{t["status.ongoing"]}</span>}
              </div>
              <p class="small">
                {n.ends_at
                  ? fmt(t["status.range"], { start: when(n.starts_at), end: when(n.ends_at) })
                  : fmt(t["status.since"], { start: when(n.starts_at) })}
              </p>
              <p class="muted small">{t[`status.about.${n.kind}`]}</p>
            </li>
          ))}
        </ul>
      ))}
      {at && <p class="muted small" data-testid="status-updated">{fmt(t["status.updated"], { time: when(at) })}</p>}
      <p class="small"><a class="strong" href={href("/feedback/?from=status")}>{t["feedback.link"]}</a></p>
    </section>
  );
}
