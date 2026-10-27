import en from "./en.json";
import zhCN from "./zh-CN.json";
import zhTW from "./zh-TW.json";

export const LOCALES = ["zh-TW", "zh-CN", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export type MessageKey = keyof typeof zhTW;

// zh-TW is the default and has no path prefix, the others live under /zh-cn/ and /en/
export const PREFIX: Record<Locale, string> = { "zh-TW": "", "zh-CN": "/zh-cn", en: "/en" };
export const HTML_LANG: Record<Locale, string> = { "zh-TW": "zh-Hant-TW", "zh-CN": "zh-Hans-CN", en: "en" };
export const LANGUAGE_NAME: Record<Locale, string> = { "zh-TW": "正體中文", "zh-CN": "简体中文", en: "English" };

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { "zh-TW": zhTW, "zh-CN": zhCN, en };

/** Split a pathname into its locale and the rest, e.g. "/en/devices/" -> ["en", "/devices/"]. */
export function splitLocale(pathname: string): [Locale, string] {
  for (const locale of LOCALES) {
    const prefix = PREFIX[locale];
    if (prefix && (pathname === prefix || pathname.startsWith(prefix + "/"))) {
      return [locale, pathname.slice(prefix.length) || "/"];
    }
  }
  return ["zh-TW", pathname];
}

export function messagesOf(locale: Locale): Record<MessageKey, string> {
  return MESSAGES[locale];
}
