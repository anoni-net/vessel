import { useEffect, useState } from "preact/hooks";
import { type NetworkReport, type Status, api } from "../api.ts";
import { Icon } from "../icons.tsx";
import { useCtx } from "../context.ts";
import { formatCount, formatTime } from "../format.ts";
import { type MessageKey, fmt } from "../i18n/index.ts";
import { faqAnchor } from "./faq.tsx";
import { Spin } from "./skeleton.tsx";
import { announce } from "../announce.ts";
import { type CheckState, type Exit, dnsState, encodeCheck, exitCheck, exitState, exitText, isOld, notConnected, passed } from "../connection.ts";
import { type Verdict, runCheck } from "../dnscheck.ts";
import { sitesHere } from "../reach.ts";
import { CLEARNET, IS_ONION } from "../site.ts";
import { type UdpResult, udpCheck } from "../udpcheck.ts";

type Result = { exit: Exit; dns: Verdict };

const summaryOf = (r: Result) => (passed(r.exit, r.dns) ? "ok" : notConnected(r.exit, r.dns) ? "off" : "problem");

export function Check() {
  const { t, href, locale } = useCtx();
  const [state, setState] = useState<"idle" | "running" | Result>("idle");
  const run = async () => {
    if (state === "running") return;
    setState("running");
    const [exit, dns] = await Promise.all([exitCheck(), runCheck()]);
    setState({ exit, dns });
    // the answer, for those who cannot see it appear; the rows under it are there to read on
    const summary = summaryOf({ exit, dns });
    announce(summary === "off" ? `${t["check.off"]}${locale === "en" ? " " : ""}${t["check.off.more"]}` : t[`check.${summary}`]);
  };
  const result = typeof state === "object" ? state : null;
  const summary = result && summaryOf(result);
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
          <button class="nb-button nb-button--primary" type="button" onClick={run} aria-disabled={state === "running"} aria-busy={state === "running"}>
            {state === "running" ? <><Spin />{t["check.running"]}</> : result ? t["check.again"] : t["check.button"]}
          </button>
          {result && (
            <>
              {/* the answer first, big enough to read at a glance; the two checks below say why */}
              <p class={`check-verdict check-verdict--${summary === "problem" ? "bad" : summary}`}>
                <Icon name={summary === "ok" ? "ok" : summary === "off" ? "wifi" : "cancel"} />
                {summary === "off" ? (
                  <span>{t["check.off"]}<span class="check-verdict__more">{t["check.off.more"]}</span></span>
                ) : t[`check.${summary ?? "problem"}`]}
              </p>
              <dl class="check-rows">
                <div>
                  <dt class="strong">{t["check.exit"]}</dt>
                  <dd><StateBadge state={exitState(result.exit)} /></dd>
                  <dd class="small check-rows__detail" data-testid="check-exit">{exitText(t, result.exit)}</dd>
                </div>
                <div>
                  <dt class="strong">{t["check.dns"]}</dt>
                  <dd><StateBadge state={dnsState(result.dns)} /></dd>
                  <dd class="small check-rows__detail" data-testid="check-dns">{t[`dns.check.${result.dns}`]}</dd>
                </div>
              </dl>
              {/* through a node: how that node is doing, from the status page */}
              {!["none", "ipv6", "error"].includes(result.exit) && !isOld(result.exit) && <NodeStatus region={result.exit} />}
              {isOld(result.exit) && <a class="nb-button nb-button--ink" href={href("/devices/")}>{t["home.devices"]}</a>}
              <a class="nb-button" href={href(`/feedback/?from=check&check=${encodeCheck(result.exit, result.dns)}`)}>
                {t["check.feedback"]}
              </a>
              {/* on Vessel, the network would be the node's host: of no use to the visitor */}
              {(result.exit === "none" || result.exit === "ipv6") && <NetworkChecks />}
              {result.exit !== "none" && result.exit !== "ipv6" && result.exit !== "error" && (
                <p class="small" data-testid="check-network-hint">{t["check.networkHint"]}</p>
              )}
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

/** The node the visitor is on: its state and the latest notice about it, as /status/ shows them. Nothing when the status
 *  cannot be read: the checks above already answer whether the connection works. */
function NodeStatus({ region }: { region: string }) {
  const { t, href, locale } = useCtx();
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    api.status().then(setStatus, () => setStatus(null));
  }, [region]);
  const node = status?.regions.find((r) => r.id === region);
  if (!status || !node) return null;
  // newest first, as the API sends them; a notice for every region counts too
  const notice = status.notices.find((n) => n.region === region || n.region === null);
  const ongoing = notice && (notice.ends_at === null || new Date(notice.ends_at) > new Date());
  const kind = notice ? t[`status.kind.${notice.kind}`] : "";
  // sentences run on in Chinese; English needs the space
  const gap = locale === "en" ? " " : "";
  // whether this node cannot open a site another city's node can: the status page says which, by region
  const reach = status.reach ?? [];
  const blocked = sitesHere(reach, region, "blocked");
  const cityName = (r: string) => t[`region.${r}` as MessageKey] ?? r;
  return (
    <p class="small" data-testid="check-node">
      {fmt(t["check.node"], { city: t[`region.${region}` as MessageKey] ?? region, state: t[`status.state.${node.state}`] })}
      {gap}
      {!notice ? t["status.none"] : ongoing ? fmt(t["check.node.ongoing"], { kind }) : fmt(t["check.node.last"], { kind, time: formatTime(locale, notice.starts_at) })}
      {gap}
      <a href={href("/status/")}>{t["status.title"]}</a>
      {blocked.length > 0 && (
        <span class="check-reach" data-testid="check-reach">
          {fmt(t["check.reach.note"], { city: cityName(region) })}<a href={href("/status/#reach")}>{t["status.reach.title"]}</a>{t["check.reach.noteAfter"]}
        </span>
      )}
    </p>
  );
}

const STATE_BADGE = { pass: "ok", fail: "down", update: "down", unknown: "unknown" } as const;

function StateBadge({ state }: { state: CheckState }) {
  const { t } = useCtx();
  return (
    <span class={`badge badge--icon badge--state-${STATE_BADGE[state]}`}>
      {state === "pass" && <Icon name="ok" />}
      {state === "fail" && <Icon name="cancel" />}
      {t[`check.state.${state}`]}
    </span>
  );
}

/** Off Vessel: whether the network lets UDP out, then what OONI has measured on it. One request gives both. */
function NetworkChecks() {
  const [report, setReport] = useState<NetworkReport | "failed" | null>(null);
  useEffect(() => {
    api.network().then(setReport, () => setReport("failed"));
  }, []);
  return (
    <>
      {report && report !== "failed" && report.stun && <UdpSection server={report.stun} />}
      <NetworkSection report={report} />
    </>
  );
}

/** Sends UDP to a public STUN server, see udpcheck.ts. The result stays on the page. */
function UdpSection({ server }: { server: string }) {
  const { t } = useCtx();
  const [result, setResult] = useState<UdpResult | null>(null);
  useEffect(() => {
    udpCheck(server).then(setResult, () => setResult("unknown"));
  }, [server]);
  return (
    <section class="stack check-network" data-testid="check-udp" aria-busy={result === null}>
      <h2>{t["check.udp.title"]}</h2>
      <p>{t["check.udp.lead"]}</p>
      <dl class="check-rows">
        <div>
          <dt class="strong">{t["check.udp.row"]}</dt>
          <dd>{result === null ? <span class="small"><Spin />{t["check.udp.running"]}</span> : <StateBadge state={result} />}</dd>
          {result !== null && <dd class="small check-rows__detail">{t[`check.udp.${result}`]}</dd>}
        </div>
      </dl>
      <p class="muted small">{t["check.udp.privacy"]}</p>
    </section>
  );
}

const LEVEL_BADGE = { ok: "ok", some: "down", most: "down", few: "unknown", unknown: "unknown" } as const;

/** OONI's public measurements of the visitor's network. Nothing here tests the connection: see api/app/network.py. */
function NetworkSection({ report }: { report: NetworkReport | "failed" | null }) {
  const { t, href, locale } = useCtx();
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
          <ul class="plain check-rows">
            {known.tests.map((test) => (
              <li>
                <span class="strong">{t[`check.network.test.${test.id}`]}</span>
                <span class={`badge badge--state-${LEVEL_BADGE[test.level]}`}>{t[`check.network.level.${test.level}`]}</span>
                {test.level !== "unknown" && test.measurements > 0 && (
                  <span class="muted small check-rows__detail">
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
