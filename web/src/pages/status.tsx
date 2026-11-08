import { useEffect, useState } from "preact/hooks";
import { Icon } from "../icons.tsx";
import { type Status, api } from "../api.ts";
import type { Reach } from "../reach.ts";
import { useCtx } from "../context.ts";
import { formatTime } from "../format.ts";
import { type MessageKey, fmt } from "../i18n/index.ts";
import { joinNames, sitesHere } from "../reach.ts";
import { flagOf } from "../regions.ts";
import { SkCard } from "./skeleton.tsx";

const REFRESH_EVERY = 2 * 60_000;

/** Under a city: the sites its node cannot open that another city's can, and the ones behind a bot check. */
function ReachLine({ region, reach, names }: { region: string; reach: Reach[]; names: (s: string[]) => string }) {
  const { t } = useCtx();
  if (!reach.some((r) => r.region === region)) return null;
  const blocked = sitesHere(reach, region, "blocked");
  const challenge = sitesHere(reach, region, "challenge");
  return (
    <div class="small status-reach" data-testid={`status-reach-${region}`}>
      {blocked.length === 0 && challenge.length === 0 && <p class="muted">{t["status.reach.allOk"]}</p>}
      {blocked.length > 0 && <p>{fmt(t["status.reach.blocked"], { sites: names(blocked) })}</p>}
      {challenge.length > 0 && <p class="muted">{fmt(t["status.reach.challenge"], { sites: names(challenge) })}</p>}
    </div>
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
              <ReachLine region={r.id} reach={reach} names={names} />
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
      {reach.length > 0 && (
        <details class="small status-reach-how" data-testid="status-reach-how">
          <summary>{t["status.reach.title"]}</summary>
          <p>{t["status.reach.how"]}</p>
          <p>{fmt(t["status.reach.list"], { sites: names(Object.keys(reach[0].sites)) })}</p>
        </details>
      )}

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
