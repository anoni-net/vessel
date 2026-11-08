import { useEffect, useState } from "preact/hooks";
import { Icon } from "../icons.tsx";
import { type Status, api } from "../api.ts";
import type { Reach } from "../reach.ts";
import { useCtx } from "../context.ts";
import { formatTime } from "../format.ts";
import { type MessageKey, fmt } from "../i18n/index.ts";
import { REACH_GROUPS, type ReachGroup, joinNames, sitesHere } from "../reach.ts";
import { flagOf } from "../regions.ts";
import { SkCard } from "./skeleton.tsx";

const REFRESH_EVERY = 2 * 60_000;

/** The sites each city's node cannot open that another city's can, by the region the sites serve, so readers look at
 *  the group of their own place. A group where every city opens everything is left out. */
function ReachSection({ reach, names, city }: { reach: Reach[]; names: (s: string[]) => string; city: (id: string) => string }) {
  const { t, href } = useCtx();
  const groups = (Object.keys(REACH_GROUPS) as ReachGroup[]).map((group) => {
    const inGroup = (sites: string[]) => sites.filter((s) => (REACH_GROUPS[group] as readonly string[]).includes(s));
    const lines = reach.flatMap((r) => {
      const blocked = inGroup(sitesHere(reach, r.region, "blocked"));
      const challenge = inGroup(sitesHere(reach, r.region, "challenge"));
      return [
        ...(blocked.length ? [{ key: `${r.region}-b`, text: fmt(t["status.reach.blocked"], { city: city(r.region), sites: names(blocked) }), muted: false }] : []),
        ...(challenge.length ? [{ key: `${r.region}-c`, text: fmt(t["status.reach.challenge"], { city: city(r.region), sites: names(challenge) }), muted: true }] : []),
      ];
    });
    return { group, lines };
  });
  const shown = groups.filter((g) => g.lines.length > 0);
  return (
    <>
      <h2 id="reach">{t["status.reach.title"]}</h2>
      <p>{t["status.reach.lead"]}</p>
      {shown.length === 0 ? (
        <p class="card card--dashed" data-testid="status-reach-none">{t["status.reach.allOk"]}</p>
      ) : (
        <ul class="plain status-reach" data-testid="status-reach">
          {shown.map(({ group, lines }) => (
            <li class="card card--flat" data-testid={`status-reach-${group}`}>
              <h3 class="status-reach__group">{t[`reach.group.${group}`]}</h3>
              {lines.map((l) => <p class={`small${l.muted ? " muted" : ""}`} key={l.key}>{l.text}</p>)}
            </li>
          ))}
        </ul>
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
  )
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
      {reach.length > 0 && <ReachSection reach={reach} names={names} city={(id) => city(id)} />}

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
