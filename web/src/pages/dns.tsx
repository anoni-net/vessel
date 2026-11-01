import { useState } from "preact/hooks";
import { ApiError, type BlocklistAnswer, api } from "../api.ts";
import { useCtx } from "../context.ts";
import { blockedReport } from "../feedback.ts";
import { Spin } from "./skeleton.tsx";
import { type Verdict, runCheck } from "../dnscheck.ts";
import { type MessageKey, errorText, fmt } from "../i18n/index.ts";

const OPTIONS = ["none", "malware", "ads"] as const;
const LIMITS = [1, 2, 3, 4, 5] as const;
const LISTS = "https://github.com/hagezi/dns-blocklists";
const TW165 = "https://data.gov.tw/dataset/176455";

export function Dns() {
  const { t, locale } = useCtx();
  return (
    <section class="wrap narrow stack dns-page">
      <h1>{t["dns.title"]}</h1>
      <p class="lead">{t["dns.lead"]}</p>

      <DnsCheck />
      <Lookup />

      <h2>{t["dns.options.title"]}</h2>
      <div class="stack">
        {OPTIONS.map((o) => (
          <div class="card card--flat">
            <h3>{t[`filter.${o}`]}</h3>
            <p>{t[`dns.option.${o}`]}</p>
          </div>
        ))}
      </div>

      <h2>{t["dns.how.title"]}</h2>
      <p>
        {t["dns.how.body"]} <a href={LISTS} target="_blank" rel="noopener">{t["dns.how.lists"]}</a>
        {t["dns.how.and"]}<a href={TW165} target="_blank" rel="noopener">{t["dns.how.tw165"]}</a>
        {locale === "en" ? "." : "。"}
      </p>
      <p>{t["dns.how.private"]}</p>

      <h2>{t["dns.limits.title"]}</h2>
      <ul>
        {LIMITS.map((n) => <li>{t[`dns.limits.${n}` as MessageKey]}</li>)}
      </ul>

      <h2>{t["dns.change.title"]}</h2>
      <p>{t["dns.change.body"]}</p>
    </section>
  );
}

function DnsCheck() {
  const { t, href, locale } = useCtx();
  const [state, setState] = useState<"idle" | "running" | Verdict>("idle");
  const check = async () => {
    setState("running");
    setState(await runCheck());
  };
  return (
    <div class="card card--tint stack" data-testid="dns-check">
      <h2>{t["dns.check.title"]}</h2>
      <p>{t["dns.check.body"]}</p>
      <button class="nb-button nb-button--primary" type="button" onClick={check} disabled={state === "running"} aria-busy={state === "running"}>
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

/** Is a site on the lists? For a site that will not open with a filter on; the answer names the filters that block it. */
function Lookup() {
  const { t, href } = useCtx();
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<BlocklistAnswer | null>(null);
  const [err, setErr] = useState("");
  const look = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setAnswer(null);
    try {
      setAnswer(await api.blocklist(domain));
    } catch (x) {
      setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    } finally {
      setBusy(false);
    }
  };
  // the Taiwanese lists first: what they say (Taiwan's ISPs block the site too) matters most, and their appeals go
  // to the agencies that keep them, not to us
  const list = answer && (answer.tw165 ? "tw165" : answer.twmoda ? "twmoda" : answer.malware ? "malware" : answer.ads ? "ads" : null);
  const agency = list === "tw165" || list === "twmoda";
  return (
    <form class="card stack" onSubmit={look} data-testid="dns-lookup">
      <h2>{t["dns.lookup.title"]}</h2>
      <p>{t["dns.lookup.body"]}</p>
      <label for="lookup-domain" class="strong">{t["dns.lookup.label"]}</label>
      <input id="lookup-domain" class="nb-input" required maxLength={2048} autoComplete="off" autoCapitalize="none"
        spellcheck={false} inputMode="url" placeholder={t["dns.lookup.placeholder"]} value={domain}
        onInput={(e) => setDomain(e.currentTarget.value)} />
      <button class="nb-button nb-button--ink" type="submit" disabled={busy} aria-busy={busy}>
        {busy ? <><Spin />{t["dns.lookup.running"]}</> : t["dns.lookup.button"]}
      </button>
      {err && <p class="error" role="alert">{err}</p>}
      {answer && (
        <div class={`lookup-answer${list ? " lookup-answer--hit" : ""}`} role="status" data-testid="lookup-answer">
          <p class="strong">{fmt(t[`dns.lookup.${list ?? "none"}`], { domain: answer.domain })}</p>
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
