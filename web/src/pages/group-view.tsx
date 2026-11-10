import { useEffect, useState } from "preact/hooks";
import { type GroupAccount, type GroupDevice, type Me, api } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatDate } from "../format.ts";
import { type MessageKey, fmt } from "../i18n/index.ts";
import { progress } from "../inspection-progress.ts";

/**
 * An inspection a leader asked for, in the leaders' own words (toomore/anoni-net-ws#483): the member sees the state
 * the leaders see. Not the summary, which is sealed to the leaders' keys; the member's own report has all of it.
 */
function InspectionLine({ d }: { d: GroupDevice }) {
  // how many days it was set to run: the member's view of the group does not carry the setting
  const daysOf = (x: NonNullable<GroupDevice["inspection"]>) =>
    x.started_at && x.ends_at ? Math.round((Date.parse(x.ends_at) - Date.parse(x.started_at)) / 86_400_000) : 7;
  const { t, locale, href } = useCtx();
  const it = d.inspection!;
  const day = (iso: string) => formatDate(locale, iso);
  const line = it.status === "requested" ? fmt(t["group.inspect.status.requested"], { date: day(it.until!) })
    : it.status === "active" && it.ends_at ? fmt(t["group.inspect.status.active"], progress({ ends_at: it.ends_at, days: daysOf(it) }))
    : it.status === "ended" && it.report_until ? fmt(t["group.inspect.status.ended"], { date: day(it.report_until) })
    : t[`group.inspect.status.${it.status}` as MessageKey];
  return (
    <span class="small block group-view__issue" data-testid={`group-view-inspection-${d.id}`}>
      <span class="strong">{t["group.inspect.label"]}</span>{t["group.inspect.sep"]}{line}{" "}
      {it.status !== "declined" && it.status !== "deleted" && (
        <a href={`${href("/devices/inspect/")}?d=${encodeURIComponent(d.id)}`}
          aria-label={fmt(t["group.view.inspectNamed"], { name: d.name })}>{t["group.view.inspect"]}</a>
      )}
    </span>
  );
}

/** On an account in a group: what its leaders see about it, the same words and states as their own page. */
export function GroupView({ me }: { me: Me | null }) {
  const { t, locale } = useCtx();
  const [view, setView] = useState<GroupAccount | null>(null);
  const inGroup = !!me?.group;
  useEffect(() => {
    // a part of the page nobody needs to finish what they came for: when it fails, it is simply not shown
    if (inGroup) api.myGroupView().then(setView).catch(() => undefined);
  }, [inGroup]);
  if (!me?.group || !view) return null;
  const day = (iso: string) => formatDate(locale, iso);
  const city = (id: string) => t[`region.${id}` as MessageKey] ?? id;
  return (
    <div class="stack account-section" data-testid="group-view">
      <h2>{t["group.view.title"]}</h2>
      {me.group.closing_on && <p class="strong">{fmt(t["group.closingMember"], { date: day(me.group.closing_on) })}</p>}
      <p>{t["group.view.body"]}</p>
      <div class="card card--flat stack group-account">
        <span>
          <span class="strong big">{view.label}</span>
          <span class="muted small block">{fmt(t["group.joined"], { date: day(view.joined_on) })}</span>
        </span>
        {view.devices.length === 0 ? <p class="muted small">{t["group.noDevices"]}</p> : (
          <ul class="stack-sm plain">
            {view.devices.map((d) => (
              <li class="group-device">
                <span>
                  <span class="strong">{d.name}</span>{" "}
                  <span class={`badge badge--${d.status}`}>{t[`status.${d.status}`]}</span>
                  <span class="muted small block">{city(d.region)} · {t[`filter.${d.dns_filter}`]}</span>
                  {d.issues.map((issue) => (
                    <span class="small block group-view__issue">
                      <span class="strong">{t[`group.issue.${issue}`]}</span> {t[`group.help.${issue}`]}
                    </span>
                  ))}
                  {d.inspection && <InspectionLine d={d} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {me.group.device_revoked_on && (
        <p class="muted small" data-testid="group-view-revoked">{fmt(t["group.view.revoked"], { date: day(me.group.device_revoked_on) })}</p>
      )}
    </div>
  );
}
