import { useState } from "preact/hooks";
import { useCtx } from "../context.ts";
import { type Verdict, runCheck } from "../dnscheck.ts";
import type { MessageKey } from "../i18n/index.ts";

const OPTIONS = ["none", "malware", "ads"] as const;
const LIMITS = [1, 2, 3, 4, 5] as const;
const LISTS = "https://github.com/hagezi/dns-blocklists";

export function Dns() {
  const { t, locale } = useCtx();
  return (
    <section class="wrap narrow stack dns-page">
      <h1>{t["dns.title"]}</h1>
      <p class="lead">{t["dns.lead"]}</p>

      <DnsCheck />

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
  const { t } = useCtx();
  const [state, setState] = useState<"idle" | "running" | Verdict>("idle");
  const check = async () => {
    setState("running");
    setState(await runCheck());
  };
  return (
    <div class="card card--tint stack" data-testid="dns-check">
      <h2>{t["dns.check.title"]}</h2>
      <p>{t["dns.check.body"]}</p>
      <button class="nb-button nb-button--primary" type="button" onClick={check} disabled={state === "running"}>
        {state === "running" ? t["dns.check.running"] : t["dns.check.button"]}
      </button>
      <p role="status" class="strong">
        {state === "idle" || state === "running" ? "" : t[`dns.check.${state}`]}
      </p>
      <p class="muted small">{t["dns.check.privacy"]}</p>
    </div>
  );
}
