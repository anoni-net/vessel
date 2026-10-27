import type { Locale } from "./i18n/index.ts";
import { HTML_LANG } from "./i18n/index.ts";

export function formatBytes(locale: Locale, bytes: number): string {
  const gb = bytes / 1e9;
  const digits = gb < 10 ? 1 : 0;
  return new Intl.NumberFormat(HTML_LANG[locale], { maximumFractionDigits: digits }).format(gb) + " GB";
}

export function formatDate(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(HTML_LANG[locale], { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" })
    .format(new Date(iso + "T00:00:00Z"));
}
