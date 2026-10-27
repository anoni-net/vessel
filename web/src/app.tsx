import { browserDeclines, optedOut, setOptedOut, trackView } from "./analytics.ts";
import { LocaleContext, useCtx } from "./context.ts";
import { HTML_LANG, LANGUAGE_NAME, LANGUAGE_SHORT, LOCALES, type MessageKey, PREFIX, messagesOf, splitLocale } from "./i18n/index.ts";
import { normalizePath } from "./pages.ts";
import { Account } from "./pages/account.tsx";
import { Devices } from "./pages/devices.tsx";
import { Dns } from "./pages/dns.tsx";
import { Faq } from "./pages/faq.tsx";
import { Home } from "./pages/home.tsx";
import { Login } from "./pages/login.tsx";
import { Redeem } from "./pages/redeem.tsx";
import { Legal, NotFound } from "./pages/simple.tsx";
import { usePath } from "./router.ts";
import { FAVICON, LOGO } from "./images.ts";
import { titleOf } from "./seo.ts";
import { checkSession, useSignedIn } from "./session.ts";
import { useEffect, useState } from "preact/hooks";

// key generation and the QR code are only needed here, so they load with this page
function NewDevice() {
  const [Page, setPage] = useState<(() => preact.JSX.Element) | null>(null);
  useEffect(() => {
    import("./pages/new-device.tsx").then((m) => setPage(() => m.NewDevice));
  }, []);
  return Page ? <Page /> : null;
}

// Material Design Icons "translate" (Apache 2.0), the icon the news site uses for its language links
function TranslateIcon() {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12.87,15.07L10.33,12.56L10.36,12.53C12.1,10.59 13.34,8.36 14.07,6H17V4H10V2H8V4H1V6H12.17C11.5,7.92 10.44,9.75 9,11.35C8.07,10.32 7.3,9.19 6.69,8H4.69C5.42,9.63 6.42,11.17 7.67,12.56L2.58,17.58L4,19L9,14L12.11,17.11L12.87,15.07M18.5,10H16.5L12,22H14L15.12,19H19.87L21,22H23L18.5,10M15.88,17L17.5,12.67L19.12,17H15.88Z" />
    </svg>
  );
}

function StatsChoice() {
  const { t } = useCtx();
  const [off, setOff] = useState(optedOut());
  if (browserDeclines()) return <p class="footer-legal">{t["stats.note"]} {t["stats.declined"]}</p>;
  const toggle = () => {
    setOptedOut(!off);
    setOff(!off);
  };
  return (
    <p class="footer-legal">
      {t["stats.note"]} {off && <>{t["stats.stopped"]} </>}
      <button type="button" class="footer-toggle" onClick={toggle}>{off ? t["stats.resume"] : t["stats.stop"]}</button>
    </p>
  );
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
  "/faq/": ["faq.title", () => <Faq />],
  "/dns/": ["dns.title", () => <Dns />],
  "/terms/": ["terms.title", () => <Legal doc="terms" titleKey="terms.title" />],
  "/privacy/": ["privacy.title", () => <Legal doc="privacy" titleKey="privacy.title" />],
};

// scripts/prerender.mjs checks these against the page lists in seo.ts, since nginx serves only prerendered pages
export const ROUTE_PATHS = Object.keys(ROUTES);

/** `url` is the page to render when prerendering; in the browser the location decides. */
export function App({ url }: { url?: string } = {}) {
  const [locale, rest] = splitLocale(usePath(url));
  const t = messagesOf(locale);
  const path = normalizePath(rest);
  const route = ROUTES[path];
  const href = (p: string) => PREFIX[locale] + p;
  const signedIn = useSignedIn();
  useEffect(checkSession, []);
  // like the news site: the header and footer link to the same page in the other two languages
  const others = LOCALES.filter((l) => l !== locale);

  // after the page has rendered, so the title and path are the new page's
  useEffect(() => {
    if (route) trackView(path);
  }, [locale, path]);

  if (typeof document !== "undefined") {
    document.documentElement.lang = HTML_LANG[locale];
    document.title = titleOf(locale, path) ?? `${t["notFound.title"]} · Vessel`;
  }

  return (
    <LocaleContext.Provider value={{ locale, t, href }}>
      <header class="site-header">
        <div class="wrap site-header__inner">
          {/* same as Gears and the news site: the anoni.net wordmark, a divider, then the product name */}
          <a class="brand" href={href("/")}>
            <img class="brand__logo" src={LOGO} alt="anoni.net" width="116" height="28" />
            <span class="brand__product">Vessel</span>
          </a>
          <nav aria-label={t["nav.main"]} class="site-nav">
            <a class="site-nav__anchor" href={href("/#how")}>{t["nav.how"]}</a>
            <a class="site-nav__anchor" href={href("/#limits")}>{t["nav.limits"]}</a>
            <a class="site-nav__anchor" href={href("/#data")}>{t["nav.data"]}</a>
            <a class="site-nav__anchor" href={href("/faq/")}>{t["nav.faq"]}</a>
            <span class="site-header__langs" role="group" aria-label={t["lang.label"]}>
              <TranslateIcon />
              {others.map((l) => (
                <a href={PREFIX[l] + path} hreflang={HTML_LANG[l]} lang={HTML_LANG[l]} aria-label={LANGUAGE_NAME[l]}>{LANGUAGE_SHORT[l]}</a>
              ))}
            </span>
            {!SIGNED_IN.has(path) && (signedIn
              ? <a class="nb-button" href={href("/devices/")}>{t["nav.devices"]}</a>
              : <a class="nb-button" href={href("/login/")}>{t["nav.login"]}</a>)}
          </nav>
        </div>
      </header>
      <main class="site-main" key={path}>{route ? route[1]() : <NotFound />}</main>
      <footer class="site-footer">
        <div class="wrap site-footer__inner">
          <p class="footer-brand">
            <img src={FAVICON} alt="" width="24" height="24" />
            {t["footer.service"]}
          </p>
          <nav aria-label={t["nav.footer"]} class="site-footer__links">
            <a href={href("/faq/")}>{t["faq.title"]}</a>
            <a href={href("/dns/")}>{t["dns.title"]}</a>
            <a href={href("/terms/")}>{t["terms.title"]}</a>
            <a href={href("/privacy/")}>{t["privacy.title"]}</a>
          </nav>
        </div>
        <div class="wrap">
          <nav class="site-footer__langs" aria-label={t["lang.label"]}>
            <TranslateIcon /> {t["lang.others"]}
            {others.map((l, i) => (
              <>
                {i > 0 && t["lang.sep"]}
                <a href={PREFIX[l] + path} hreflang={HTML_LANG[l]} lang={HTML_LANG[l]}>{LANGUAGE_NAME[l]}</a>
              </>
            ))}
          </nav>
        </div>
        <div class="wrap">
          <StatsChoice />
          <p class="footer-legal">
            {t["footer.trademarks"]} <a href="https://www.wireguard.com/" target="_blank" rel="noopener">wireguard.com</a>
          </p>
        </div>
      </footer>
    </LocaleContext.Provider>
  );
}
