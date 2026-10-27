import { LocaleContext } from "./context.ts";
import { HTML_LANG, LANGUAGE_NAME, LOCALES, type MessageKey, PREFIX, messagesOf, splitLocale } from "./i18n/index.ts";
import { normalizePath } from "./pages.ts";
import { Account } from "./pages/account.tsx";
import { Devices } from "./pages/devices.tsx";
import { Home } from "./pages/home.tsx";
import { Login } from "./pages/login.tsx";
import { Redeem } from "./pages/redeem.tsx";
import { Legal, NotFound } from "./pages/simple.tsx";
import { usePath } from "./router.ts";
import { useEffect, useState } from "preact/hooks";

// key generation and the QR code are only needed here, so they load with this page
function NewDevice() {
  const [Page, setPage] = useState<(() => preact.JSX.Element) | null>(null);
  useEffect(() => {
    import("./pages/new-device.tsx").then((m) => setPage(() => m.NewDevice));
  }, []);
  return Page ? <Page /> : null;
}

// pages that need a session show their own account links instead of "sign in"
const SIGNED_IN = new Set(["/devices/", "/devices/new/", "/account/"]);

const ROUTES: Record<string, [MessageKey, () => preact.JSX.Element]> = {
  "/": ["home.title", () => <Home />],
  "/redeem/": ["redeem.title", () => <Redeem />],
  "/login/": ["login.title", () => <Login />],
  "/devices/": ["devices.title", () => <Devices />],
  "/devices/new/": ["new.title", () => <NewDevice />],
  "/account/": ["account.title", () => <Account />],
  "/terms/": ["terms.title", () => <Legal titleKey="terms.title" />],
  "/privacy/": ["privacy.title", () => <Legal titleKey="privacy.title" />],
};

export function App() {
  const [locale, rest] = splitLocale(usePath());
  const t = messagesOf(locale);
  const path = normalizePath(rest);
  const route = ROUTES[path];
  const href = (p: string) => PREFIX[locale] + p;

  document.documentElement.lang = HTML_LANG[locale];
  document.title = route && path !== "/" ? `${t[route[0]]} · Vessel` : path === "/" ? "Vessel" : `${t["notFound.title"]} · Vessel`;

  return (
    <LocaleContext.Provider value={{ locale, t, href }}>
      <header class="site-header">
        <div class="wrap site-header__inner">
          {/* same as Gears and the news site: the anoni.net wordmark, a divider, then the product name */}
          <a class="brand" href={href("/")}>
            <img class="brand__logo" src="/logo-wordmark-tonal.svg" alt="anoni.net" width="116" height="28" />
            <span class="brand__product">Vessel</span>
          </a>
          <nav aria-label={t["nav.main"]} class="site-nav">
            <a class="site-nav__anchor" href={href("/#how")}>{t["nav.how"]}</a>
            <a class="site-nav__anchor" href={href("/#limits")}>{t["nav.limits"]}</a>
            <a class="site-nav__anchor" href={href("/#data")}>{t["nav.data"]}</a>
            {!SIGNED_IN.has(path) && <a class="nb-button" href={href("/login/")}>{t["nav.login"]}</a>}
          </nav>
        </div>
      </header>
      <main class="site-main" key={path}>{route ? route[1]() : <NotFound />}</main>
      <footer class="site-footer">
        <div class="wrap site-footer__inner">
          <p class="footer-brand">
            <img src="/favicon.svg" alt="" width="24" height="24" />
            {t["footer.service"]}
          </p>
          <nav aria-label={t["nav.language"]} class="site-footer__links">
            <a href={href("/terms/")}>{t["terms.title"]}</a>
            <a href={href("/privacy/")}>{t["privacy.title"]}</a>
            {LOCALES.map((l) => (
              <a href={PREFIX[l] + path} hreflang={HTML_LANG[l]} lang={HTML_LANG[l]} aria-current={l === locale ? "true" : undefined}>
                {LANGUAGE_NAME[l]}
              </a>
            ))}
          </nav>
        </div>
      </footer>
    </LocaleContext.Provider>
  );
}
