import { useEffect, useState } from "preact/hooks";
import { type NetworkReport, api } from "../api.ts";
import { Icon } from "../icons.tsx";
import { useCtx } from "../context.ts";
import { formatCount } from "../format.ts";
import { fmt } from "../i18n/index.ts";
import { faqAnchor } from "./faq.tsx";
import { Spin } from "./skeleton.tsx";
import { type Exit, encodeCheck, exitCheck, exitText, isOld, passed } from "../connection.ts";
import { type Verdict, runCheck } from "../dnscheck.ts";
import { CLEARNET, IS_ONION } from "../site.ts";

type Result = { exit: Exit; dns: Verdict };

export function Check() {
  const { t, href } = useCtx();
  const [state, setState] = useState<"idle" | "running" | Result>("idle");
  const run = async () => {
    setState("running");
    const [exit, dns] = await Promise.all([exitCheck(), runCheck()]);
    setState({ exit, dns });
  };
  const result = typeof state === "object" ? state : null;
  return (
    <section class="wrap narrow stack check-page">
      <h1>{t["check.title"]}</h1>
      <p class="lead">{t["check.lead"]}</p>

      <div class="check-cols">
      {/* over Tor neither the address nor the lookups go through Vessel: say where to run it instead */}
      {IS_ONION ? (
        <div class="card card--tint stack" data-testid="connection-check">
          <p>{t["check.onion"]}</p>
          <a class="nb-button nb-button--primary" href={CLEARNET + href("/check/")}>{t["check.onion.open"]}</a>
        </div>
      ) : (
        <div class="card card--tint stack" data-testid="connection-check">
          <button class="nb-button nb-button--primary" type="button" onClick={run} disabled={state === "running"} aria-busy={state === "running"}>
            {state === "running" ? <><Spin />{t["check.running"]}</> : result ? t["check.again"] : t["check.button"]}
          </button>
          {result && (
            <>
              {/* the answer first, big enough to read at a glance; the two checks below say why */}
              <p class={`check-verdict ${passed(result.exit, result.dns) ? "check-verdict--ok" : "check-verdict--bad"}`} role="status">
                <Icon name={passed(result.exit, result.dns) ? "ok" : "cancel"} />
                {passed(result.exit, result.dns) ? t["check.ok"] : t["check.problem"]}
              </p>
              <dl class="check-results">
                <div>
                  <dt>{t["check.exit"]}</dt>
                  <dd data-testid="check-exit">{exitText(t, result.exit)}</dd>
                </div>
                <div>
                  <dt>{t["check.dns"]}</dt>
                  <dd data-testid="check-dns">{t[`dns.check.${result.dns}`]}</dd>
                </div>
              </dl>
              {isOld(result.exit) && <a class="nb-button nb-button--ink" href={href("/devices/")}>{t["home.devices"]}</a>}
              <a class="nb-button" href={href(`/feedback/?from=check&check=${encodeCheck(result.exit, result.dns)}`)}>
                {t["check.feedback"]}
              </a>
              {/* on Vessel, the network would be the node's host: of no use to the visitor */}
              {(result.exit === "none" || result.exit === "ipv6") && <NetworkSection />}
            </>
          )}
          <p class="muted small">{t["check.privacy"]}</p>
        </div>
      )}

      <div class="check-next" data-testid="check-next">
      <h2>{t["check.next.title"]}</h2>
      <h3>{t["check.next.exit.title"]}</h3>
      <p>{t["check.next.exit.body"]}</p>
      <p class="small"><a href={href("/faq/#q-androidVpn")}>{t["faq.androidVpn.q"]}</a></p>
      <h3>{t["check.next.dns.title"]}</h3>
      <p>{t["check.next.dns.body"]}</p>
      <p class="small"><a href={href("/dns/")}>{t["dns.link"]}</a></p>
      <h3>{t["check.next.sites.title"]}</h3>
      <p>{t["check.next.sites.body"]}</p>
      </div>
      </div>
    </section>
  );
}

const LEVEL_BADGE = { ok: "ok", some: "down", most: "down", few: "unknown", unknown: "unknown" } as const;

/** OONI's public measurements of the visitor's network. Nothing here tests the connection: see api/app/network.py. */
function NetworkSection() {
  const { t, href, locale } = useCtx();
  const [report, setReport] = useState<NetworkReport | "failed" | null>(null);
  useEffect(() => {
    api.network().then(setReport, () => setReport("failed"));
  }, []);
  const known = report && report !== "failed" && report.asn !== null ? report : null;
  const end = locale === "en" ? "." : "。";
  return (
    <section class="stack check-network" data-testid="check-network" aria-busy={report === null}>
      <h2>{t["check.network.title"]}</h2>
      {report === null && <p><Spin />{t["check.network.loading"]}</p>}
      {report !== null && !known && <p>{t["check.network.none"]}</p>}
      {known && (
        <>
          <p>{fmt(t["check.network.lead"], { name: known.name ?? "", asn: `AS${known.asn}`, days: String(known.days) })}</p>
          <ul class="plain check-network__tests">
            {known.tests.map((test) => (
              <li>
                <span class="strong">{t[`check.network.test.${test.id}`]}</span>
                <span class={`badge badge--state-${LEVEL_BADGE[test.level]}`}>{t[`check.network.level.${test.level}`]}</span>
                {test.level !== "unknown" && test.measurements > 0 && (
                  <span class="muted small check-network__count">
                    {fmt(t["check.network.count"], { n: formatCount(locale, test.measurements), pct: String(test.anomaly_pct) })}
                    {test.confirmed > 0 && fmt(t["check.network.confirmed"], { n: formatCount(locale, test.confirmed) })}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p class="small">{t["check.network.note"]}</p>
          {known.tests.some((test) => test.level === "some" || test.level === "most") && (
            <p class="small">{t["lists.coverage.risky"]}<a href={href(`/faq/#${faqAnchor("risky")}`)}>{t["lists.coverage.riskyLink"]}</a>{end}</p>
          )}
          {known.tests.some((test) => test.level === "few") && (
            <p class="small">{t["check.network.few"]}<a href="https://ooni.org/install/" target="_blank" rel="noopener">OONI Probe</a>{end}</p>
          )}
          <p class="small"><a href={`https://explorer.ooni.org/as/AS${known.asn}`} target="_blank" rel="noopener">{t["check.network.more"]}</a></p>
          <p class="muted small">
            {t["check.network.privacy"]}{t["check.network.license"]}
            <a href="https://github.com/ooni/license/tree/master/data" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>{end}
          </p>
        </>
      )}
    </section>
  );
}
