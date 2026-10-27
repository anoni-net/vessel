import { HTML_LANG, LANGUAGE_NAME, LOCALES, PREFIX, messagesOf, splitLocale } from "./i18n/index.ts";
import { PAGES, normalizePath } from "./pages.ts";

export function App() {
  const [locale, rest] = splitLocale(location.pathname);
  const t = messagesOf(locale);
  const path = normalizePath(rest);
  const titleKey = PAGES[path];
  const href = (p: string) => PREFIX[locale] + p;

  document.documentElement.lang = HTML_LANG[locale];
  document.title = titleKey && path !== "/" ? `${t[titleKey]} · Vessel` : "Vessel";

  return (
    <>
      <header class="site-header">
        <a class="wordmark" href={href("/")}>Vessel</a>
        <nav aria-label={t["nav.main"]} class="site-nav">
          <a href={href("/#how")}>{t["nav.how"]}</a>
          <a href={href("/#limits")}>{t["nav.limits"]}</a>
          <a class="nb-button" href={href("/login/")}>{t["nav.login"]}</a>
        </nav>
      </header>
      <main class="site-main">
        {path === "/" ? (
          <section class="hero">
            <h1>{t["home.title"]}</h1>
            <p class="lead">{t["home.lead"]}</p>
            <p>
              <a class="nb-button nb-button--primary" href={href("/redeem/")}>{t["home.invite"]}</a>
            </p>
            <p class="muted">{t["home.inviteOnly"]}</p>
          </section>
        ) : (
          <section>
            <h1>{t[titleKey ?? "notFound.title"]}</h1>
            <p class="muted">{t["placeholder"]}</p>
          </section>
        )}
      </main>
      <footer class="site-footer">
        <p>{t["footer.service"]}</p>
        <nav aria-label={t["nav.language"]} class="lang-nav">
          {LOCALES.map((l) => (
            <a href={PREFIX[l] + path} hreflang={HTML_LANG[l]} aria-current={l === locale ? "true" : undefined}>
              {LANGUAGE_NAME[l]}
            </a>
          ))}
        </nav>
      </footer>
    </>
  );
}
