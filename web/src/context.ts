import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Locale, T } from "./i18n/index.ts";

export interface Ctx {
  locale: Locale;
  t: T;
  /** prefix a path with the current locale */
  href: (path: string) => string;
  /** the page shown, without the locale's prefix: `/devices/` */
  path: string;
}

export const LocaleContext = createContext<Ctx>(null as unknown as Ctx);
export const useCtx = () => useContext(LocaleContext);
