import { useEffect, useState } from "preact/hooks";
import { ApiError, type Device, type Me, api } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatBytes, formatDate } from "../format.ts";
import { errorText, fmt } from "../i18n/index.ts";
import { navigate } from "../router.ts";
import { AccountNav } from "./account.tsx";

export function Devices() {
  const { t, href, locale } = useCtx();
  const [me, setMe] = useState<Me | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const [m, d] = await Promise.all([api.me(), api.devices()]);
      setMe(m);
      setDevices(d);
    } catch (x) {
      if (x instanceof ApiError && x.code === "signed_out") navigate(href("/login/"), true);
      else setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    }
  };
  useEffect(() => {
    load();
  }, []);

  const remove = async (d: Device) => {
    if (!window.confirm(fmt(t["devices.confirmDelete"], { name: d.name }))) return;
    try {
      await api.deleteDevice(d.id);
    } catch (x) {
      setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    }
    load();
  };

  if (err) return <section class="wrap narrow"><p class="error" role="alert">{err}</p></section>;
  if (!me || !devices) return <section class="wrap narrow"><p class="muted">{t["loading"]}</p></section>;

  const pct = Math.min(100, Math.round((me.used_bytes / me.monthly_quota_bytes) * 100));

  return (
    <section class="wrap narrow stack">
      <AccountNav />
      <div class="row">
        <h1>{t["devices.title"]}</h1>
        <span class="muted strong">{fmt(t["devices.count"], { n: devices.length, max: me.device_limit })}</span>
      </div>

      <div class="card card--tint card--flat">
        <div class="row strong">
          <span>{t["devices.usage"]}</span>
          <span>{formatBytes(locale, me.used_bytes)} / {formatBytes(locale, me.monthly_quota_bytes)}</span>
        </div>
        <div class="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
          aria-label={t["devices.usage"]}>
          <div style={{ width: `${pct}%` }} />
        </div>
        <p class="muted small">{t["devices.usageNote"]}</p>
      </div>

      {devices.length === 0 ? (
        <div class="card card--dashed">
          <p class="strong">{t["devices.empty"]}</p>
          <p class="muted">{t["devices.emptyBody"]}</p>
        </div>
      ) : (
        <ul class="stack plain" data-testid="device-list">
          {devices.map((d) => (
            <li class="card">
              <div class="row">
                <div>
                  <p class="strong big">{d.name}</p>
                  <p class="muted small">
                    {t[`region.${d.region}` as keyof typeof t] ?? d.region} · {t[`filter.${d.dns_filter}`]}
                  </p>
                </div>
                <span class={`badge badge--${d.status}`}>{t[`status.${d.status}`]}</span>
              </div>
              {d.status === "pending" && <p class="muted small">{t["status.pendingNote"]}</p>}
              {d.status === "suspended" && <p class="muted small">{t["status.suspendedNote"]}</p>}
              <div class="row small">
                <span>{fmt(t["devices.expires"], { date: formatDate(locale, d.expires_on) })}</span>
                {d.status !== "revoking" && (
                  <button class="link-button" type="button" onClick={() => remove(d)}>{t["devices.delete"]}</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p class="muted small center">
        {fmt(t["devices.limitNote"], { max: me.device_limit, quota: formatBytes(locale, me.monthly_quota_bytes) })}
      </p>
    </section>
  );
}
