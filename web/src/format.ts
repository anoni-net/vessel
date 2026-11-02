import type { Locale } from "./i18n/index.ts";
import { HTML_LANG } from "./i18n/index.ts";

// Decimal units, like the quota (50 GB = 50 × 10⁹ bytes) and phone carriers. Under 1 GB the usage is
// shown in whole MB, so the first days of use do not read as "0 GB"; from 1 GB on, one decimal below 10 GB.
export function formatBytes(locale: Locale, bytes: number): string {
  const num = (n: number, digits: number) =>
    new Intl.NumberFormat(HTML_LANG[locale], { maximumFractionDigits: digits }).format(n);
  if (bytes <= 0) return "0 MB";
  if (bytes < 0.5e6) return "< 1 MB";
  // 999.6 MB would round to "1,000 MB"; show it as 1 GB instead
  if (bytes < 999.5e6) return `${num(bytes / 1e6, 0)} MB`;
  const gb = bytes / 1e9;
  return `${num(gb, gb < 9.95 ? 1 : 0)} GB`;
}

/** A count with the locale's thousands separator: 1,234 次 */
export function formatCount(locale: Locale, n: number): string {
  return new Intl.NumberFormat(HTML_LANG[locale]).format(n);
}

// Share of the monthly quota. Small shares keep one decimal so the first days of use do not read as 0%.
export function formatPercent(locale: Locale, used: number, quota: number): string {
  if (used <= 0 || quota <= 0) return "0%";
  const share = used / quota;
  if (share < 0.001) return "< 0.1%";
  return new Intl.NumberFormat(HTML_LANG[locale], { style: "percent", maximumFractionDigits: share < 0.095 ? 1 : 0 })
    .format(share);
}

export function formatDate(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(HTML_LANG[locale], { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" })
    .format(new Date(iso + "T00:00:00Z"));
}

/** A moment in the visitor's own time zone: the time alone when it is today, otherwise with the date. */
export function formatTime(locale: Locale, iso: string, now = new Date()): string {
  const at = new Date(iso);
  const today = at.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(HTML_LANG[locale], {
    ...(today ? {} : { month: "2-digit", day: "2-digit" }),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}
