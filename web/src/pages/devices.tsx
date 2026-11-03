import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../icons.tsx";
import { ApiError, type Device, type Me, api, last } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatBytes, formatCount, formatDate, formatPercent, formatTime } from "../format.ts";
import { errorText, fmt } from "../i18n/index.ts";
import { navigate } from "../router.ts";
import { setSignedIn } from "../session.ts";
import { flagOf } from "../regions.ts";
import { AccountNav } from "./account.tsx";
import { Layers } from "./layers.tsx";
import { loadNewDevice, whenIdle } from "./lazy.ts";
import { Added, NextRead, useTween } from "./live.tsx";
import { Busy, SkButton, SkCard, Spin } from "./skeleton.tsx";

// The worker reads the nodes' counters every 5 minutes, so refreshing more often shows nothing new. The page asks
// a little after each read is due, so the new numbers have landed; when a read is late, it asks again after 1, 2
// and 4 minutes, then every 5. A device the node is still adding turns active within seconds, so while one is
// pending the page checks more often.
const READ_EVERY = 5 * 60_000;
const READ_LANDS = 20_000;
const LATE_FIRST = 60_000;
const PENDING_EVERY = 10_000;
// coming back to the tab refreshes, unless the page just did
const FRESH_FOR = 15_000;

const visible = () => document.visibilityState === "visible";
/** when the page asks for the read after the one in `asOf` */
const dueAfter = (asOf: string) => Date.parse(asOf) + READ_EVERY + READ_LANDS;

// What this tab saw at each read, by device, kept in memory like `last`: a device whose traffic grew between two
// reads in a row was in use during those 5 minutes. Until the page has seen two reads, it does not say either way.
const seen = new Map<string, { asOf: number; used: number }>();
const inUse = new Map<string, boolean>();
function track(me: Me, devices: Device[]) {
  if (!me.usage_as_of) return;
  const asOf = Date.parse(me.usage_as_of);
  for (const d of devices) {
    const before = seen.get(d.id);
    if (before && asOf > before.asOf) {
      // a gap of more than one read, or a new month starting over, says nothing about the last 5 minutes
      if (asOf - before.asOf <= READ_EVERY + 2 * 60_000 && d.used_bytes >= before.used) inUse.set(d.id, d.used_bytes > before.used);
      else inUse.delete(d.id);
    }
    if (!before || asOf > before.asOf) seen.set(d.id, { asOf, used: d.used_bytes });
  }
}

const countsBlocked = (d: Device) => d.dns_filter !== "none" && d.status !== "revoking";
const blockedOf = (devices: Device[]) => devices.filter(countsBlocked).reduce((n, d) => n + d.blocked, 0);

/** What a read added to the numbers on screen, for the "+12 MB" on each card; `n` counts reads. */
interface Read { n: number; used: number; blocked: number; devices: Map<string, { used: number; blocked: number }> }

export function Devices() {
  const { t, href, locale } = useCtx();
  // what this tab saw last time, if anything, while the page asks again
  const [me, setMe] = useState<Me | null>(last.me ?? null);
  const [devices, setDevices] = useState<Device[] | null>(last.devices ?? null);
  const [err, setErr] = useState("");

  const [added, setAdded] = useState<Read | null>(null);

  const busy = useRef(false);
  const loadedAt = useRef(0);
  const shown = useRef({ me, devices });

  /** `quiet`: a background refresh; if it fails, keep what is on screen instead of an error. Returns the account as
   * the page now shows it. */
  const load = async (quiet = false): Promise<Me | null> => {
    if (busy.current) return shown.current.me;
    busy.current = true;
    try {
      const [m, d] = await Promise.all([api.me(), api.devices()]);
      track(m, d);
      const before = shown.current;
      if (before.me && before.devices) {
        const was = new Map(before.devices.map((x) => [x.id, x]));
        const devs = new Map<string, { used: number; blocked: number }>();
        for (const x of d) {
          const p = was.get(x.id);
          if (p) devs.set(x.id, { used: x.used_bytes - p.used_bytes, blocked: x.blocked - p.blocked });
        }
        const a = { used: m.used_bytes - before.me.used_bytes, blocked: blockedOf(d) - blockedOf(before.devices), devices: devs };
        if (a.used > 0 || a.blocked > 0 || [...devs.values()].some((v) => v.used > 0 || v.blocked > 0)) {
          setAdded((x) => ({ n: (x?.n ?? 0) + 1, ...a }));
        }
      }
      shown.current = { me: m, devices: d };
      setMe(m);
      setDevices(d);
      setErr("");
      loadedAt.current = Date.now();
      return m;
    } catch (x) {
      if (x instanceof ApiError && x.code === "signed_out") {
        setSignedIn(false);
        navigate(href("/login/"), true);
      } else if (!quiet) setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
      return shown.current.me;
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    let timer = 0;
    let late = 0;
    let lastRead: string | null | undefined;
    // the next refresh, from when the read on screen happened
    const plan = (m: Me | null) => {
      clearTimeout(timer);
      const read = m?.usage_as_of;
      late = read && read === lastRead ? late + 1 : 0;
      lastRead = read;
      const due = read ? dueAfter(read) - Date.now() : READ_EVERY;
      timer = window.setTimeout(tick, due > 5_000 ? Math.min(due, READ_EVERY) : Math.min(LATE_FIRST * 2 ** late, READ_EVERY));
    };
    const tick = async () => plan(visible() ? await load(true) : shown.current.me);
    void load().then(plan);
    // the next page most people open from here
    whenIdle(() => void loadNewDevice().catch(() => undefined));
    // e.g. back from the AmneziaWG app
    const back = async () => {
      if (visible() && Date.now() - loadedAt.current > FRESH_FOR) plan(await load(true));
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      clearTimeout(timer);
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

  return <DeviceList me={me} devices={devices} added={added} deleting={deleting} remove={remove} />;
}

function DeviceList({ me, devices, added, deleting, remove }: {
  me: Me; devices: Device[]; added: Read | null; deleting: ReadonlySet<string>; remove: (d: Device) => void;
}) {
  const { t, href, locale } = useCtx();
  // the numbers count up to a new read; the bar and the ARIA values take the read as it is
  const used = useTween(me.used_bytes);
  const pct = Math.min(100, Math.round((me.used_bytes / me.monthly_quota_bytes) * 100));
  const share = formatPercent(locale, used, me.monthly_quota_bytes);
  const amount = `${formatBytes(locale, used)} / ${formatBytes(locale, me.monthly_quota_bytes)}`;
  const ariaAmount = `${formatBytes(locale, me.used_bytes)} / ${formatBytes(locale, me.monthly_quota_bytes)}`;
  const full = devices.filter((d) => d.status !== "revoking").length >= me.device_limit;
  const overQuota = me.used_bytes >= me.monthly_quota_bytes;
  // only devices with a DNS filter count blocked lookups; with none, the card says nothing about it. With a filter
  // and nothing blocked yet (early in the month, a new device), it says the protection is on.
  const filtered = devices.filter(countsBlocked);
  const blocked = Math.round(useTween(blockedOf(devices)));
  // the "+…" of a read stay until the page asks for the next one
  const nextAt = me.usage_as_of ? dueAfter(me.usage_as_of) : Date.now() + READ_EVERY;
  // the visitor's own date, as YYYY-MM-DD, to tell whether a moved device's old host is already gone
  const today = new Date().toLocaleDateString("sv");

  return (
    <section class="wrap narrow stack">
      <AccountNav />
      <div class="row">
        <h1>{t["devices.title"]}</h1>
        <span class="muted strong">{fmt(t["devices.count"], { n: devices.length, max: me.device_limit })}</span>
      </div>

      <div class="card card--tint card--flat card--live">
        {added && <Added key={added.n} until={nextAt} items={plusOf(t, locale, added.used, filtered.length > 0 ? added.blocked : 0)} />}
        <div class="row usage-head">
          <span class="strong">{t["devices.usage"]}</span>
          <span class="usage-pct" data-testid="usage-percent">{share}</span>
        </div>
        <div class="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
          aria-valuetext={formatPercent(locale, me.used_bytes, me.monthly_quota_bytes) + (locale === "en" ? ", " : "，") + ariaAmount} aria-label={t["devices.usage"]}>
          {/* any use at all shows a sliver, so a few MB does not look like nothing */}
          <div style={{ width: me.used_bytes > 0 ? `max(${pct}%, 6px)` : "0" }} />
        </div>
        {/* the amount and when it was read share one line; the note explains both */}
        <div class="row usage-amount">
          <span class="strong">{amount}</span>
          {me.usage_as_of && (
            <span class="muted small usage-as-of" data-testid="usage-as-of">
              {fmt(t["devices.usageAsOf"], { time: formatTime(locale, me.usage_as_of) })}
              <NextRead from={Date.parse(me.usage_as_of)} dueAt={dueAfter(me.usage_as_of)}
                label={fmt(t["devices.nextRead"], { time: formatTime(locale, new Date(dueAfter(me.usage_as_of)).toISOString()) })} />
            </span>
          )}
        </div>
        <p class="muted small">{t["devices.usageNote"]}</p>
        {filtered.length > 0 && (
          <p class="usage-blocked" data-testid="blocked-total">
            {blocked > 0
              ? fmt(t[filtered.some((d) => d.dns_filter === "ads") ? "devices.blockedTotalAds" : "devices.blockedTotal"], { n: formatCount(locale, blocked) })
              : t["devices.blockedNone"]}
          </p>
        )}
      </div>

      {devices.length === 0 ? (
        <div class="card card--dashed">
          <p class="strong">{t["devices.empty"]}</p>
          <p class="muted">{t["devices.emptyBody"]}</p>
          <p class="muted small">{t["devices.emptyExpired"]}</p>
        </div>
      ) : (
        <ul class="stack plain device-list" data-testid="device-list">
          {devices.map((d) => (
            <li class="card card--live" aria-busy={deleting.has(d.id)}>
              {added?.devices.get(d.id) && (
                <Added key={added.n} until={nextAt} items={plusOf(t, locale, added.devices.get(d.id)!.used, d.dns_filter === "none" ? 0 : added.devices.get(d.id)!.blocked)} />
              )}
              <div class="row device-head">
                <p class="strong big device-head__name">{d.name}</p>
                <span class={`badge badge--${d.status}`}>{t[`status.${d.status}`]}</span>
              </div>
              {/* the full width of the card, so it rarely wraps; when it does, each icon stays with its words */}
              <p class="muted small device-meta">
                <span class="device-meta__part">
                  {flagOf(d.region) && <img class="flag flag--small" src={flagOf(d.region)} alt="" width="20" height="15" />}
                  <span class="device-meta__text">{t[`region.${d.region}` as keyof typeof t] ?? d.region}</span>
                </span>
                <span class="device-meta__text" aria-hidden="true">·</span>
                <span class="device-meta__part">
                  <Layers filter={d.dns_filter} small />
                  <span class="device-meta__text">{t[`filter.${d.dns_filter}`]}</span>
                </span>
              </p>
              <DeviceUsage d={d} />
              {d.status === "pending" && <p class="muted small">{t["status.pendingNote"]}</p>}
              {d.status === "active" && !d.connected && (
                <p class="muted small" data-testid="not-connected">
                  {t["devices.notConnected"]} <a href={href("/faq/#q-trouble")}>{t["faq.trouble.q"]}</a>
                </p>
              )}
              {d.status === "suspended" && <p class="muted small">{t["status.suspendedNote"]}</p>}
              {d.moved_until && (
                <p class="card card--warn card--flat small notice" data-testid="moved">
                  <Icon name="warning" />
                  <span>{fmt(t[d.moved_until < today ? "devices.movedGone" : "devices.moved"], {
                    city: t[`region.${d.region}` as keyof typeof t] ?? d.region,
                    date: formatDate(locale, d.moved_until),
                  })}{locale === "en" ? " " : ""}{full ? t["devices.movedDeleteFirst"] : t["devices.movedAdd"]}</span>
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

/** This month's traffic and blocked lookups of one device, with a dot for whether it was in use in the last read. */
function DeviceUsage({ d }: { d: Device }) {
  const { t, locale } = useCtx();
  const used = useTween(d.used_bytes);
  const blocked = Math.round(useTween(d.blocked));
  const active = d.status === "active" ? inUse.get(d.id) : undefined;
  return (
    <div class="device-usage small">
      {active !== undefined && (
        <span class={`live-dot${active ? " live-dot--on" : ""}`} title={t[active ? "devices.inUse" : "devices.idle"]}>
          <span class="sr-only">{t[active ? "devices.inUse" : "devices.idle"]}</span>
        </span>
      )}
      <p data-testid="device-usage">
        {fmt(t["devices.used"], { amount: formatBytes(locale, used) })}
        {d.dns_filter !== "none" && <>{" · "}{fmt(t[d.dns_filter === "ads" ? "devices.blockedAds" : "devices.blocked"], { n: formatCount(locale, blocked) })}</>}
      </p>
    </div>
  );
}

/** "+210 MB", "擋下 +13": what one read added, leaving out what did not grow or rounds to nothing */
function plusOf(t: ReturnType<typeof useCtx>["t"], locale: ReturnType<typeof useCtx>["locale"], used: number, blocked: number) {
  const items: string[] = [];
  if (used >= 0.5e6) items.push(`+${formatBytes(locale, used)}`);
  if (blocked > 0) items.push(fmt(t["devices.addedBlocked"], { n: formatCount(locale, blocked) }));
  return items;
}
