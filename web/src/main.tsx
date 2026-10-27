import { hydrate, render } from "preact";
import { App } from "./app.tsx";
import { splitLocale } from "./i18n/index.ts";
import { normalizePath } from "./pages.ts";
import { preloadLegal } from "./pages/simple.tsx";
import "./styles.css";

// Pages are prerendered (scripts/prerender.mjs). On the page the HTML was made for, pick it up instead of
// replacing it; elsewhere (404.html in another language, a path without its trailing slash) start over.
// A legal page's text is loaded first, so the first render matches what was prerendered.
const root = document.getElementById("app")!;
const [locale, rest] = splitLocale(location.pathname);
const path = normalizePath(rest);
preloadLegal(locale, path).finally(() => {
  if (root.dataset.path === location.pathname) return hydrate(<App />, root);
  root.textContent = "";
  render(<App />, root);
});
