import { hydrate, render } from "preact";
import { App } from "./app.tsx";
import { homeRedirect } from "./langpref.ts";
import { splitLocale } from "./i18n/index.ts";
import { normalizePath } from "./pages.ts";
import { preloadLegal } from "./pages/simple.tsx";
// IBM Plex Mono (SIL OFL) for the wordmark, labels and figures, served from the site itself: the latin subset only,
// since Chinese falls back to the system's sans-serif
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-700-italic.css";
import "./styles.css";

// Pages are prerendered (scripts/prerender.mjs). On the page the HTML was made for, pick it up instead of
// replacing it; elsewhere (404.html in another language, a path without its trailing slash) start over.
// A legal page's text is loaded first, so the first render matches what was prerendered.
const root = document.getElementById("app")!;
const [locale, rest] = splitLocale(location.pathname);
const path = normalizePath(rest);
// the bare address goes to the language this browser picked before (langpref.ts); a reload of the other
// language's prerendered home, so nothing here renders first
const home = homeRedirect(location.pathname);
if (home) location.replace(home + location.search + location.hash);
else preloadLegal(locale, path).finally(() => {
  if (root.dataset.path === location.pathname) return hydrate(<App />, root);
  root.textContent = "";
  render(<App />, root);
});
