// Built with `vite build --ssr` and run by scripts/prerender.mjs: the HTML of every page, before any script runs.
import { renderToString } from "preact-render-to-string";
import { App } from "./app.tsx";
export { ROUTE_PATHS } from "./app.tsx";
import { preloadLegal } from "./pages/simple.tsx";
import { LOCALES, PREFIX, type Locale } from "./i18n/index.ts";

export { HTML_LANG } from "./i18n/index.ts";
export { PRIVATE_PAGES, PUBLIC_PAGES, SITE, headTags, titleOf, urlOf } from "./seo.ts";
export { LOCALES, PREFIX };

export async function renderPage(locale: Locale, path: string): Promise<string> {
  await preloadLegal(locale, path);
  return renderToString(<App url={PREFIX[locale] + path} />);
}
