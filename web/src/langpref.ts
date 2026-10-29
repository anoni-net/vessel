// The visitor's language. Pages never redirect by the browser's language: shared links and the newsletter
// already name a language, and Cloudflare caches one page per address. Instead:
//   - when the browser prefers another language the site has, a small bar offers it, until it is used or closed
//   - a language picked from the header, the footer or that bar is remembered, and opening the bare address
//     (/) goes to that language's home
// Both live in this browser's storage, which can be missing or throw.
import { LOCALES, type Locale, PREFIX } from "./i18n/index.ts";

const CHOICE = "vessel-lang";
const DISMISSED = "vessel-lang-hint";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // no storage: the bar comes back next time, and / stays in Traditional Chinese
  }
}

export function chosenLocale(): Locale | null {
  const v = read(CHOICE);
  return (LOCALES as readonly string[]).includes(v ?? "") ? (v as Locale) : null;
}

export function rememberLocale(locale: Locale) {
  write(CHOICE, locale);
}

export function dismissHint() {
  write(DISMISSED, "1");
}

/** The site's language closest to what the browser asks for, if there is a clear one. */
export function browserLocale(languages: readonly string[] = navigator.languages ?? [navigator.language]): Locale | null {
  for (const tag of languages) {
    const t = tag.toLowerCase();
    if (/^zh-(tw|hk|mo)\b|^zh-hant\b/.test(t)) return "zh-TW";
    if (/^zh-(cn|sg|my)\b|^zh-hans\b/.test(t)) return "zh-CN";
    // plain "zh" could be either script
    if (t === "zh") return null;
    if (t.startsWith("en")) return "en";
  }
  return null;
}

/** The language to offer on a page in `locale`, or null when there is nothing to offer. */
export function suggestedLocale(locale: Locale): Locale | null {
  if (chosenLocale() || read(DISMISSED)) return null;
  const wanted = browserLocale();
  return wanted && wanted !== locale ? wanted : null;
}

/** Where the bare address should send this visitor, or null to stay. Only "/" is redirected. */
export function homeRedirect(pathname: string): string | null {
  if (pathname !== "/") return null;
  const chosen = chosenLocale();
  return chosen && chosen !== "zh-TW" ? PREFIX[chosen] + "/" : null;
}
