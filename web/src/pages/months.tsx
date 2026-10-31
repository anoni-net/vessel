import type { DnsFilter, UsageMonth, UsageMonths } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatBytes } from "../format.ts";
import { HTML_LANG, fmt } from "../i18n/index.ts";
import { SkLine } from "./skeleton.tsx";

const KEPT = 12;
// the first month the two blocklists were counted apart, as in the backend (app/auth.py BLOCKED_SINCE)
const COUNTED_FROM = 2026 * 12 + 10;

/** How many months the record will list, from the account's creation date: the skeleton has as many rows. */
export function monthsSince(createdOn: string | undefined, today = new Date()): number {
  if (!createdOn) return 1;
  const made = new Date(createdOn + "T00:00:00Z");
  const n = (today.getUTCFullYear() - made.getUTCFullYear()) * 12 + today.getUTCMonth() - made.getUTCMonth() + 1;
  return Math.min(KEPT, Math.max(1, n));
}

/** The lines under a month's name, as the record will show them for the filter the devices most likely use. */
function skeletonCounts(guess: DnsFilter, back: number, today = new Date()): number {
  if (guess === "none") return 0;
  const month = today.getUTCFullYear() * 12 + today.getUTCMonth() - back;
  return month < COUNTED_FROM ? 1 : guess === "ads" ? 2 : 1;
}

/**
 * The account page's monthly record: traffic, and the lookups each blocklist stopped. Accounts that never used a
 * filter see the traffic only; the ads list's count appears once a device uses it or it has blocked something.
 */
export function Months({ data, rows, guess }: { data: UsageMonths | null | undefined; rows: number; guess: DnsFilter }) {
  const { t, locale } = useCtx();
  const num = (n: number) => new Intl.NumberFormat(HTML_LANG[locale]).format(n);
  const name = (m: UsageMonth, i: number) => {
    const month = new Intl.DateTimeFormat(HTML_LANG[locale], { year: "numeric", month: "long", timeZone: "UTC" })
      .format(new Date(m.month + "T00:00:00Z"));
    return i === 0 ? fmt(t["months.current"], { month }) : month;
  };
  const months = data?.months ?? [];
  const showBlocked = data?.filter !== "none" || months.some((m) => (m.blocked ?? 0) + (m.blocked_ads ?? 0) > 0);
  const showAds = data?.filter === "ads" || months.some((m) => (m.blocked_ads ?? 0) > 0);
  const count = (label: string, n: number, id: string) => (
    <span class="row small" data-testid={id}><span class="muted">{label}</span><span>{fmt(t["months.times"], { n: num(n) })}</span></span>
  );
  return (
    <div class="stack" data-testid="months">
      <h2>{t["months.title"]}</h2>
      {data === null ? (
        <p class="muted">{t["months.failed"]}</p>
      ) : (
        <ul class="card card--flat plain months">
          {data === undefined
            ? Array.from({ length: rows }, (_, i) => (
              <li class="month month--skeleton" aria-hidden="true">
                <span><SkLine w="mid" /></span>
                {Array.from({ length: skeletonCounts(guess, i) }, () => <span class="small"><SkLine w="long" /></span>)}
              </li>
            ))
            : months.map((m, i) => (
              <li class="month appear">
                <span class="row">
                  <span class="strong">{name(m, i)}</span>
                  <span data-testid="month-used">{formatBytes(locale, m.used_bytes)}</span>
                </span>
                {showBlocked && (m.blocked === null || m.blocked_ads === null
                  ? <span class="muted small block" data-testid="month-not-yet">{t["months.notYet"]}</span>
                  : <>
                    {count(t["months.malware"], m.blocked, "month-malware")}
                    {showAds && count(t["months.ads"], m.blocked_ads, "month-ads")}
                  </>)}
              </li>
            ))}
        </ul>
      )}
      <p class="muted small">{t["months.kept"]}</p>
    </div>
  );
}
