import { useEffect, useState } from "preact/hooks";
import { type GroupAccount, type Me, api } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatDate } from "../format.ts";
import { type MessageKey, fmt } from "../i18n/index.ts";

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
