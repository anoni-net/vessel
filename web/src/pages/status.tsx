import { useEffect, useState } from "preact/hooks";
import { Icon } from "../icons.tsx";
import { type Status, api } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatTime } from "../format.ts";
import { type MessageKey, fmt } from "../i18n/index.ts";
import { flagOf } from "../regions.ts";
import { SkCard } from "./skeleton.tsx";

const REFRESH_EVERY = 2 * 60_000;

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

  return (
    <section class="wrap narrow stack">
      <h1>{t["status.title"]}</h1>
      <p class="lead">{t["status.lead"]}</p>
      {failed && <p class="error" role="alert">{t["status.failed"]}</p>}

      <h2>{t["status.regions"]}</h2>
      {status ? (
        <ul class="stack plain" data-testid="status-regions">
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
        !failed && <SkCard lines={["long", "mid"]} />
      )}
      <p class="muted small">{t["status.how"]}</p>

      <h2>{t["status.notices"]}</h2>
      {status && (status.notices.length === 0 ? (
        <p class="card card--dashed" data-testid="status-none">{t["status.none"]}</p>
      ) : (
        <ul class="stack plain" data-testid="status-notices">
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
