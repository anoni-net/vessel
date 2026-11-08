import { useState } from "preact/hooks";
import { ApiError, type BlocklistAnswer, api } from "../api.ts";
import { useCtx } from "../context.ts";
import { blockedReport } from "../feedback.ts";
import { FILTERS, Layers } from "./layers.tsx";
import { Spin } from "./skeleton.tsx";
import { announce } from "../announce.ts";
import { type Verdict, runCheck } from "../dnscheck.ts";
import { CLEARNET, IS_ONION } from "../site.ts";
import { type MessageKey, errorText, fmt } from "../i18n/index.ts";

const LIMITS = [1, 2, 3, 4, 5, 6] as const;
const LISTS = "https://github.com/hagezi/dns-blocklists";
const TW165 = "https://data.gov.tw/dataset/176455";

export function Dns() {
  const { t, locale, href } = useCtx();
  return (
    <section class="wrap narrow stack dns-page">
      <h1>{t["dns.title"]}</h1>
      <p class="lead">{t["dns.lead"]}</p>

      <div class="dns-tools">
        <Lookup />
        <DnsCheck />
      </div>

      <h2>{t["dns.options.title"]}</h2>
      <div class="dns-options">
        {FILTERS.map((o) => (
          <div class="card card--flat">
            <h3><Layers filter={o} />{t[`filter.${o}`]}</h3>
            <p>{t[`dns.option.${o}`]}</p>
          </div>
        ))}
      </div>

      <p>
        {t["dns.how.listsPage"]}<a href={href("/dns/lists/")}>{t["lists.title"]}</a>
        {locale === "en" ? "." : "。"}
      </p>

      <div class="dns-cols">
        <div class="dns-col" data-testid="dns-col-how">
          <h2>{t["dns.how.title"]}</h2>
          <p>
            {t["dns.how.body"]} <a href={LISTS} target="_blank" rel="noopener">{t["dns.how.lists"]}</a>
            {t["dns.how.and"]}<a href={TW165} target="_blank" rel="noopener">{t["dns.how.tw165"]}</a>
            {locale === "en" ? "." : "。"}
          </p>
          <p>{t["dns.how.private"]}</p>
        </div>
        <div class="dns-col" data-testid="dns-col-limits">
          <h2>{t["dns.limits.title"]}</h2>
          <ul>
            {LIMITS.map((n) => <li>{t[`dns.limits.${n}` as MessageKey]}</li>)}
          </ul>

          <h2>{t["dns.change.title"]}</h2>
          <p>{t["dns.change.body"]}</p>
        </div>
      </div>
    </section>
  );
}

function DnsCheck() {
  const { t, href, locale } = useCtx();
  const [state, setState] = useState<"idle" | "running" | Verdict>("idle");
  const check = async () => {
    if (state === "running") return;
    setState("running");
    setState(await runCheck());
  };
  // over Tor the lookups go through Tor's exits, not Vessel's resolvers: say where to run it instead
  if (IS_ONION) {
    return (
      <div class="card card--tint stack" data-testid="dns-check">
        <h2>{t["dns.check.title"]}</h2>
        <p>{t["dns.check.onion"]}</p>
        <a class="nb-button" href={CLEARNET + href("/dns/")}>{t["check.onion.open"]}</a>
      </div>
    );
  }
  return (
    <div class="card card--tint stack" data-testid="dns-check">
      <h2>{t["dns.check.title"]}</h2>
      <p>{t["dns.check.body"]}</p>
      <button class="nb-button nb-button--primary" type="button" onClick={check} aria-disabled={state === "running"} aria-busy={state === "running"}>
        {state === "running" ? <><Spin />{t["dns.check.running"]}</> : t["dns.check.button"]}
      </button>
      <p role="status" class="strong">
        {state === "idle" || state === "running" ? "" : t[`dns.check.${state}`]}
      </p>
      <p class="muted small">{t["dns.check.privacy"]}</p>
      <p class="small">
        {t["dns.check.more"]} <a href={href("/check/")}>{t["check.title"]}</a>{locale === "en" ? "." : "。"}
      </p>
    </div>
  );
}

// the Taiwanese lists first: what they say (Taiwan's ISPs block the site too) matters most, and their appeals go
// to the agencies that keep them, not to us
const listOf = (a: BlocklistAnswer) =>
  a.tw165 ? "tw165" : a.twmoda ? "twmoda" : a.stalkerware ? "stalkerware" : a.malware ? "malware" : a.quad9 ? "quad9" : a.ads ? "ads" : null;

/** Is a site on the lists? For a site that will not open with a filter on; the answer names the filters that block it. */
function Lookup() {
  const { t, href } = useCtx();
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<BlocklistAnswer | null>(null);
  const [err, setErr] = useState("");
  const look = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    setAnswer(null);
    try {
      const a = await api.blocklist(domain);
      setAnswer(a);
      announce(fmt(t[`dns.lookup.${listOf(a) ?? "none"}`], { domain: a.domain }));
    } catch (x) {
      setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    } finally {
      setBusy(false);
    }
  };
  const list = answer && listOf(answer);
  const agency = list === "tw165" || list === "twmoda";
  return (
    <form class="card stack" onSubmit={look} data-testid="dns-lookup">
      <h2>{t["dns.lookup.title"]}</h2>
      <p>{t["dns.lookup.body"]}</p>
      <label for="lookup-domain" class="strong">{t["dns.lookup.label"]}</label>
      <input id="lookup-domain" class="nb-input" required maxLength={2048} autoComplete="off" autoCapitalize="none"
        spellcheck={false} inputMode="url" placeholder={t["dns.lookup.placeholder"]} value={domain}
        onInput={(e) => setDomain(e.currentTarget.value)} aria-invalid={err ? true : undefined}
        aria-describedby={err ? "lookup-error" : undefined} />
      <button class="nb-button nb-button--ink" type="submit" aria-disabled={busy} aria-busy={busy}>
        {busy ? <><Spin />{t["dns.lookup.running"]}</> : t["dns.lookup.button"]}
      </button>
      {err && <p class="error" role="alert" id="lookup-error">{err}</p>}
      {answer && (
        <div class={`lookup-answer${list ? " lookup-answer--hit" : ""}`} data-testid="lookup-answer">
          <p class="strong">{fmt(t[`dns.lookup.${list ?? "none"}`], { domain: answer.domain })}</p>
          {list && <p class="small"><a href={href("/dns/lists/#trouble")}>{t["dns.lookup.why"]}</a></p>}
          {list === "quad9" && <p class="small"><a href="https://quad9.net/result/" target="_blank" rel="noopener">{t["dns.lookup.quad9Check"]}</a></p>}
          {list === "tw165" && <p class="small">{t["dns.lookup.report165"]}</p>}
          {list === "twmoda" && <p class="small">{t["dns.lookup.reportModa"]}</p>}
          {list && !agency && (
            <p class="small">
              <a class="strong" href={href(`/feedback/?from=dns&${blockedReport(answer.domain, list)}`)}>{t["dns.lookup.report"]}</a>
              {" "}{t["dns.lookup.reportNote"]}
            </p>
          )}
        </div>
      )}
      <p class="muted small">{t["dns.lookup.privacy"]}</p>
    </form>
  );
}
