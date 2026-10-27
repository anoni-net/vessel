import type { MessageKey } from "./i18n/index.ts";

/** Every page of the portal, keyed by its path after the locale prefix. */
export const PAGES: Record<string, MessageKey> = {
  "/": "home.title",
  "/redeem/": "redeem.title",
  "/login/": "login.title",
  "/devices/": "devices.title",
  "/account/": "account.title",
  "/privacy/": "privacy.title",
  "/terms/": "terms.title",
};

export function normalizePath(path: string): string {
  return path.endsWith("/") ? path : path + "/";
}
