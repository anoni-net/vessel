import { HTML_LANG, LOCALES, type Locale, type MessageKey, PREFIX, messagesOf } from "./i18n/index.ts";
import { IS_ONION } from "./site.ts";

// What each page tells search engines and link previews. scripts/prerender.mjs writes it into the
// prerendered HTML of every page; the app uses the titles when it moves between pages.

export const SITE = "https://vessel.anoni.net";

// pages worth finding; the rest need a session and are marked noindex
export const PUBLIC_PAGES = ["/", "/learn/", "/faq/", "/dns/", "/dns/lists/", "/check/", "/feedback/", "/status/", "/redeem/", "/login/", "/terms/", "/privacy/"] as const;
export const PRIVATE_PAGES = ["/devices/", "/devices/new/", "/account/"] as const;

const TITLES: Record<string, MessageKey> = {
  "/redeem/": "redeem.title",
  "/login/": "login.title",
  "/devices/": "devices.title",
  "/devices/new/": "new.title",
  "/account/": "account.title",
  "/faq/": "faq.title",
  "/dns/": "dns.title",
  "/dns/lists/": "lists.title",
  "/check/": "check.title",
  "/learn/": "learn.title",
  "/feedback/": "feedback.title",
  "/status/": "status.title",
  "/terms/": "terms.title",
  "/privacy/": "privacy.title",
};

const DESCRIPTIONS: Record<string, MessageKey> = {
  "/faq/": "meta.faq",
  "/dns/": "meta.dns",
  "/dns/lists/": "meta.lists",
  "/check/": "meta.check",
  "/learn/": "meta.learn",
  "/feedback/": "meta.feedback",
  "/status/": "meta.status",
  "/redeem/": "meta.redeem",
  "/login/": "meta.login",
  "/terms/": "meta.terms",
  "/privacy/": "meta.privacy",
};

// 1200 × 630, one for every page of a language: the home page's blocks and FIG. 01 in a drawing's frame, rendered
// from the built site by scripts/og-cards.mjs, so they match it; hosted on assets.anoni.net, not in the repo
const OG_IMAGE: Record<Locale, string> = {
  "zh-TW": "https://assets.anoni.net/vessel/og-zh-tw-d6c00920.png",
  "zh-CN": "https://assets.anoni.net/vessel/og-zh-cn-bdeedae3.png",
  en: "https://assets.anoni.net/vessel/og-en-c04f9fa6.png",
};

const OG_LOCALE: Record<Locale, string> = { "zh-TW": "zh_TW", "zh-CN": "zh_CN", en: "en_US" };

/** Title for a known page, or null for one the app does not have. */
export function titleOf(locale: Locale, path: string): string | null {
  if (path === "/") return "Vessel";
  const key = TITLES[path];
  return key ? `${messagesOf(locale)[key]} · Vessel` : null;
}

export const urlOf = (locale: Locale, path: string) => SITE + PREFIX[locale] + path;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The tags that go in <head> after <title>, for a page in one language. path null is the 404 page. */
export function headTags(locale: Locale, path: string | null): string {
  const t = messagesOf(locale);
  if (path === null) return '<meta name="robots" content="noindex">';
  const indexable = (PUBLIC_PAGES as readonly string[]).includes(path);
  const title = titleOf(locale, path) ?? "Vessel";
  const description = t[DESCRIPTIONS[path] ?? "home.lead"];
  const tags = [
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${urlOf(locale, path)}">`,
  ];
  if (!indexable) return [...tags, '<meta name="robots" content="noindex">'].join("\n");
  for (const l of LOCALES) tags.push(`<link rel="alternate" hreflang="${HTML_LANG[l]}" href="${urlOf(l, path)}">`);
  tags.push(
    `<link rel="alternate" hreflang="x-default" href="${urlOf("zh-TW", path)}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Vessel">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${urlOf(locale, path)}">`,
    `<meta property="og:locale" content="${OG_LOCALE[locale]}">`,
    ...LOCALES.filter((l) => l !== locale).map((l) => `<meta property="og:locale:alternate" content="${OG_LOCALE[l]}">`),
  );
  // the share images are on assets.anoni.net; the onion build names nothing on clearnet that a browser would load
  if (!IS_ONION) {
    tags.push(
      `<meta property="og:image" content="${OG_IMAGE[locale]}">`,
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      `<meta property="og:image:alt" content="${esc(t["meta.ogAlt"])}">`,
      '<meta name="twitter:card" content="summary_large_image">',
    );
  }
  return tags.join("\n");
}
