import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, type Device, type Me, api, last } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatBytes, formatDate, formatPercent, formatTime } from "../format.ts";
import { errorText, fmt } from "../i18n/index.ts";
import { navigate } from "../router.ts";
import { setSignedIn } from "../session.ts";
import { AccountNav } from "./account.tsx";
import { loadNewDevice, whenIdle } from "./lazy.ts";
import { Busy, SkButton, SkCard, Spin } from "./skeleton.tsx";

// The worker reads the nodes' counters every 5 minutes, so refreshing more often shows nothing new. A device
// the node is still adding turns active within seconds, so while one is pending the page checks more often.
const REFRESH_EVERY = 5 * 60_000;
const PENDING_EVERY = 10_000;
// coming back to the tab refreshes, unless the page just did
const FRESH_FOR = 15_000;

const visible = () => document.visibilityState === "visible";

export function Devices() {
  const { t, href, locale } = useCtx();
  // what this tab saw last time, if anything, while the page asks again
  const [me, setMe] = useState<Me | null>(last.me ?? null);
  const [devices, setDevices] = useState<Device[] | null>(last.devices ?? null);
  const [err, setErr] = useState("");

  const busy = useRef(false);
  const loadedAt = useRef(0);

  /** `quiet`: a background refresh; if it fails, keep what is on screen instead of an error. */
  const load = async (quiet = false) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const [m, d] = await Promise.all([api.me(), api.devices()]);
      setMe(m);
      setDevices(d);
      setErr("");
      loadedAt.current = Date.now();
    } catch (x) {
      if (x instanceof ApiError && x.code === "signed_out") {
        setSignedIn(false);
        navigate(href("/login/"), true);
      } else if (!quiet) setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    load();
    // the next page most people open from here
    whenIdle(() => void loadNewDevice().catch(() => undefined));
    const every = setInterval(() => visible() && load(true), REFRESH_EVERY);
    // e.g. back from the AmneziaWG app
    const back = () => visible() && Date.now() - loadedAt.current > FRESH_FOR && load(true);
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(every);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);

  const pending = devices?.some((d) => d.status === "pending") ?? false;
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => visible() && load(true), PENDING_EVERY);
    return () => clearInterval(id);
  }, [pending]);

  // devices being deleted: the node removes the peer before the answer comes back, which takes a few seconds
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set());
  const remove = async (d: Device) => {
    if (!window.confirm(fmt(t["devices.confirmDelete"], { name: d.name }))) return;
    setDeleting((s) => new Set(s).add(d.id));
    try {
      await api.deleteDevice(d.id);
    } catch (x) {
      setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    }
    await load();
    setDeleting((s) => {
      const next = new Set(s);
      next.delete(d.id);
      return next;
    });
  };

  if (err) return <section class="wrap narrow"><p class="error" role="alert">{err}</p></section>;
  if (!me || !devices) {
    return (
      <section class="wrap narrow stack" aria-busy="true">
        <AccountNav />
        <h1>{t["devices.title"]}</h1>
        <div class="stack" aria-hidden="true">
          <SkCard tint size="usage" lines={["mid", "full", "short", "short", "long"]} />
          <SkCard size="device" lines={["mid", "long", "long", "short"]} />
          <SkCard size="device" lines={["mid", "long", "long", "short"]} />
          <SkButton />
        </div>
        <Busy />
      </section>
    );
  }

  const pct = Math.min(100, Math.round((me.used_bytes / me.monthly_quota_bytes) * 100));
  const share = formatPercent(locale, me.used_bytes, me.monthly_quota_bytes);
  const amount = `${formatBytes(locale, me.used_bytes)} / ${formatBytes(locale, me.monthly_quota_bytes)}`;
  const full = devices.filter((d) => d.status !== "revoking").length >= me.device_limit;
  const overQuota = me.used_bytes >= me.monthly_quota_bytes;
  // only devices with a DNS filter count blocked lookups; with none, the card says nothing about it
  const blocked = devices.reduce((n, d) => n + (d.dns_filter === "none" ? 0 : d.blocked), 0);
  // the visitor's own date, as YYYY-MM-DD, to tell whether a moved device's old host is already gone
  const today = new Date().toLocaleDateString("sv");

  return (
    <section class="wrap narrow stack">
      <AccountNav />
      <div class="row">
        <h1>{t["devices.title"]}</h1>
        <span class="muted strong">{fmt(t["devices.count"], { n: devices.length, max: me.device_limit })}</span>
      </div>

      <div class="card card--tint card--flat">
        <div class="row usage-head">
          <span class="strong">{t["devices.usage"]}</span>
          <span class="usage-pct" data-testid="usage-percent">{share}</span>
        </div>
        <div class="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
          aria-valuetext={share + (locale === "en" ? ", " : "，") + amount} aria-label={t["devices.usage"]}>
          {/* any use at all shows a sliver, so a few MB does not look like nothing */}
          <div style={{ width: me.used_bytes > 0 ? `max(${pct}%, 6px)` : "0" }} />
        </div>
        {/* the amount and when it was read share one line; the note explains both */}
        <div class="row usage-amount">
          <span class="strong">{amount}</span>
          {me.usage_as_of && (
            <span class="muted small" data-testid="usage-as-of">{fmt(t["devices.usageAsOf"], { time: formatTime(locale, me.usage_as_of) })}</span>
          )}
        </div>
        <p class="muted small">{t["devices.usageNote"]}</p>
        {blocked > 0 && <p class="usage-blocked" data-testid="blocked-total">{fmt(t["devices.blockedTotal"], { n: blocked })}</p>}
      </div>

      {devices.length === 0 ? (
        <div class="card card--dashed">
          <p class="strong">{t["devices.empty"]}</p>
          <p class="muted">{t["devices.emptyBody"]}</p>
          <p class="muted small">{t["devices.emptyExpired"]}</p>
        </div>
      ) : (
        <ul class="stack plain" data-testid="device-list">
          {devices.map((d) => (
            <li class="card" aria-busy={deleting.has(d.id)}>
              <div class="row">
                <div>
                  <p class="strong big">{d.name}</p>
                  <p class="muted small">
                    {t[`region.${d.region}` as keyof typeof t] ?? d.region} · {t[`filter.${d.dns_filter}`]}
                  </p>
                </div>
                <span class={`badge badge--${d.status}`}>{t[`status.${d.status}`]}</span>
              </div>
              <p class="small" data-testid="device-usage">
                {fmt(t["devices.used"], { amount: formatBytes(locale, d.used_bytes) })}
                {d.dns_filter !== "none" && <>{" · "}{fmt(t["devices.blocked"], { n: d.blocked })}</>}
              </p>
              {d.status === "pending" && <p class="muted small">{t["status.pendingNote"]}</p>}
              {d.status === "active" && !d.connected && (
                <p class="muted small" data-testid="not-connected">
                  {t["devices.notConnected"]} <a href={href("/faq/#q-trouble")}>{t["faq.trouble.q"]}</a>
                </p>
              )}
              {d.status === "suspended" && <p class="muted small">{t["status.suspendedNote"]}</p>}
              {d.moved_until && (
                <p class="card card--warn card--flat small" data-testid="moved">
                  {fmt(t[d.moved_until < today ? "devices.movedGone" : "devices.moved"], {
                    city: t[`region.${d.region}` as keyof typeof t] ?? d.region,
                    date: formatDate(locale, d.moved_until),
                  })}{locale === "en" ? " " : ""}{full ? t["devices.movedDeleteFirst"] : t["devices.movedAdd"]}
                </p>
              )}
              <div class="row small">
                <span>{fmt(t["devices.expires"], { date: formatDate(locale, d.expires_on) })}</span>
                {deleting.has(d.id) ? (
                  <span class="muted strong" role="status"><Spin />{t["busy.delete"]}</span>
                ) : d.status !== "revoking" && (
                  <button class="link-button" type="button" onClick={() => remove(d)}>{t["devices.delete"]}</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {full || overQuota ? (
        <p class="card card--dashed" data-testid="add-blocked">
          {full ? fmt(t["devices.fullHint"], { max: me.device_limit }) : t["devices.quotaHint"]}
        </p>
      ) : (
        <a class="nb-button nb-button--primary" href={href("/devices/new/")}>{t["devices.add"]}</a>
      )}
      <p class="muted small center">
        {fmt(t["devices.limitNote"], { max: me.device_limit, quota: formatBytes(locale, me.monthly_quota_bytes) })}
      </p>
      <p class="small center"><a class="strong" href={href("/feedback/?from=devices")}>{t["feedback.link"]}</a></p>
    </section>
  );
}
