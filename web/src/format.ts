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

export function formatDate(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(HTML_LANG[locale], { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" })
    .format(new Date(iso + "T00:00:00Z"));
}
