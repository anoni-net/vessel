import { useEffect, useState } from "preact/hooks";
import { type BlocklistSummary, api } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatCount, formatTime } from "../format.ts";
import { type MessageKey, fmt } from "../i18n/index.ts";
import { faqAnchor } from "./faq.tsx";
import { FILTERS, Layers } from "./layers.tsx";
import { SkLine } from "./skeleton.tsx";

const HAGEZI = "https://github.com/hagezi/dns-blocklists";
const CONTACT = "whisper@anoni.net";
const LISTS = [
  { id: "malware", href: HAGEZI },
  { id: "tw165", href: "https://data.gov.tw/dataset/176455" },
  { id: "twmoda", href: "https://data.gov.tw/dataset/165027" },
  { id: "stalkerware", href: "https://github.com/AssoEchap/stalkerware-indicators" },
  { id: "cti", href: "https://github.com/DNSBunker/CTI" },
  { id: "ads", href: HAGEZI },
] as const;
// what people pick when they make a device decides which lists apply
const GROUPS = [
  { key: "both", lists: LISTS.slice(0, 5) },
  { key: "ads", lists: LISTS.slice(5) },
] as const;
const CHART_ORDER: readonly string[] = ["cti", "ads", "malware", "tw165", "twmoda", "stalkerware"];
const EXCLUDE_FILE = "https://github.com/anoni-net/vessel/blob/main/node/exclude.txt";
// the names in node/exclude.txt; tests/dns-lists.spec.ts checks that the two match
export const EXCLUDED = [
  ["from-ia.com", "suffix"],
  ["gomlab.com", "delisted"],
  ["playinfo.gomlab.com", "delisted"],
  ["waws-prod-blu-247.sip.azurewebsites.windows.net", "shared"],
  ["waws-prod-blu-247-e7b3.eastus.cloudapp.azure.com", "shared"],
  ["wixsite.com", "hosting"],
  ["cloudflare-ipfs.com", "hosting"],
  ["graph.org", "hosting"],
  ["meusitehostgator.com.br", "hosting"],
  ["edgeone.dev", "hosting"],
  ["jumpingcrab.com", "hosting"],
  ["publicvm.com", "hosting"],
  ["myhuaweicloud-custom.com", "hosting"],
  ["hosted-by-vdsina.com", "hosting"],
  ["awsdns-531.com", "hosting"],
  ["top4top.io", "hosting"],
  ["craftum.io", "hosting"],
  ["eporner.com", "content"],
  ["pmvhaven.com", "content"],
] as const;
// Measured, not live: update these with the text around them when a measurement is repeated. Each row is the share
// blocked by Vessel's malware filter and its ads filter, Quad9 included, and by Cloudflare (1.1.1.2).
const COMPARE = [
  ["phishNew", "2–12%", "3–13%", "4–63%"],
  ["phishDay", "63–100%", "64–100%", "69–87%"],
  ["malware", "90%", "96%", "57%"],
  ["twScam", "100%", "100%", "1–2%"],
  ["tracking", "0%", "93%", "0%"],
] as const;
// phishing sites a day after they first appeared, by who reported them
const PHISHING = [
  ["certpl", 2516, 100, 100, 87],
  ["openphish", 2140, 91, 92, 75],
  ["phishunt", 131, 63, 64, 69],
] as const;
const RULES = [1, 2, 3, 4] as const;
const KNOWN = [1, 2, 3, 4, 5, 6] as const;
const QUESTIONS = ["log", "speed", "sites", "ads", "allow"] as const;
// newest first; every change to the lists adds a line
const LOG = [
  ["2026-11-09", "20261109"],
  ["2026-11-08", "20261108b"],
  ["2026-11-08", "20261108"],
  ["2026-11-07", "20261107b"],
  ["2026-11-07", "20261107"],
  ["2026-11-01", "20261101b"],
  ["2026-11-01", "20261101a"],
  ["2026-10-31", "20261031"],
  ["2026-10-27", "20261027"],
] as const;

const pct = (n: number, of: number) => `${(n / Math.max(of, 1)) * 100}%`;
const HATCH = "lists-hatch";

/** Diagonal lines on the overlapping part, so the two parts of a bar differ by more than their color. */
function HatchDefs() {
  return (
    <svg class="lists-hatch-defs" width="0" height="0" aria-hidden="true">
      <defs>
        <pattern id={HATCH} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect class="lists-hatch__base" width="6" height="6" />
          <rect class="lists-hatch__line" width="1.5" height="6" />
        </pattern>
      </defs>
    </svg>
  );
}

/** One horizontal bar: `first` from the baseline, then `rest` after a gap in the page's color. Widths are SVG
 *  attributes because the CSP blocks style attributes in the prerendered page; the end away from the baseline is
 *  rounded, a square rect covering the rounding at the other end of that segment. */
function Bar({ label, first, rest = 0, of, firstName, restName }: {
  label: string; first: number; rest?: number; of: number; firstName: string; restName?: string;
}) {
  // too thin to see, and the gap would hide it anyway
  const showRest = rest / Math.max(of, 1) >= 0.003;
  const start = (first / Math.max(of, 1)) * 100;
  return (
    <svg class="lists-bar__plot" width="100%" height="14" role="img" aria-label={label}>
      {showRest ? (
        <>
          <rect class="lists-bar__first" width={pct(first, of)} height="14"><title>{firstName}</title></rect>
          <rect fill={`url(#${HATCH})`} x={`${start}%`} width={pct(rest, of)} height="14" rx="4"><title>{restName}</title></rect>
          <rect fill={`url(#${HATCH})`} x={`${start}%`} width="4" height="14" />
          <rect class="lists-bar__gap" x={`${start}%`} width="2" height="14" />
        </>
      ) : (
        <>
          <rect class="lists-bar__first" width={pct(first, of)} height="14" rx="4"><title>{firstName}</title></rect>
          <rect class="lists-bar__first" width="4" height="14" />
        </>
      )}
    </svg>
  );
}

/** One bar out of 100%: Vessel's in the solid color, the other services' hatched, labelled beside it in the text. */
function ShareBar({ label, value, vessel }: { label: string; value: number; vessel: boolean }) {
  return (
    <svg class="lists-bar__plot" width="100%" height="14" role="img" aria-label={`${label} ${value}%`}>
      {vessel
        ? <rect class="lists-bar__first" width={`${value}%`} height="14" rx="4" />
        : <rect fill={`url(#${HATCH})`} width={`${value}%`} height="14" rx="4" />}
    </svg>
  );
}

export function DnsLists() {
  const { t, locale, href } = useCtx();
  const [summary, setSummary] = useState<BlocklistSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.blocklistSummary().then(setSummary, () => setFailed(true));
  }, []);

  const row = (id: string) => summary?.lists.find((l) => l.id === id);
  // the chart compares sizes, so largest first. Before the numbers arrive the usual order, so the rows do not move
  const byDomains = [...LISTS].sort((a, b) =>
    summary ? (row(b.id)?.domains ?? 0) - (row(a.id)?.domains ?? 0) : CHART_ORDER.indexOf(a.id) - CHART_ORDER.indexOf(b.id));
  const count = (n: number | undefined) =>
    n !== undefined ? formatCount(locale, n) : failed ? "–" : <SkLine w="short" />;

  return (
    <section class="wrap narrow stack lists-page">
      <h1>{t["lists.title"]}</h1>
      <p class="lead">{t["lists.lead"]}</p>

      <h2>{t["lists.choose.title"]}</h2>
      <ul class="plain lists-choices" data-testid="lists-choices">
        {FILTERS.map((c) => (
          <li class={`card card--flat${c === "malware" ? " card--tint" : ""}`}>
            <h3 class="lists-choice__name">
              <Layers filter={c} />
              {t[`filter.${c}`]}
              {c === "malware" && <span class="badge badge--active">{t["protect.recommended"]}</span>}
            </h3>
            <p>{t[`lists.choose.${c}`]}</p>
          </li>
        ))}
      </ul>
      <p class="muted small" data-testid="lists-choose-note">{t["lists.choose.note"]}</p>

      <div class="lists-cols">
        <div class="lists-col" data-testid="lists-trouble">
          <h2 id="trouble">{t["lists.trouble.title"]}</h2>
          <ol class="lists-steps">
            <li>{t["lists.trouble.1"]}<a href={href("/dns/")}>{t["lists.trouble.1link"]}</a>{t["lists.trouble.1after"]}</li>
            <li>{t["lists.trouble.2"]}<a href={href("/feedback/")}>{t["feedback.title"]}</a>{t["lists.trouble.2after"]}</li>
            <li>{t["lists.trouble.3"]}<a href={href("/devices/")}>{t["devices.title"]}</a>{t["lists.trouble.3after"]}</li>
            <li>{t["lists.trouble.4"]}<a href={href("/feedback/")}>{t["feedback.title"]}</a>{t["lists.trouble.4after"]}</li>
          </ol>
          <p>{t["lists.trouble.note"]}</p>
        </div>
        <div class="lists-col" data-testid="lists-questions">
          <h2>{t["lists.faq.title"]}</h2>
          <div class="faq">
            {QUESTIONS.map((q) => (
              <details class="faq__item">
                <summary>{t[`lists.faq.${q}.q`]}</summary>
                <p>{t[`lists.faq.${q}.a`]}</p>
                {q === "log" && <p>{t["lists.faq.log.more"]}<a href={href("/learn/")}>{t["learn.title"]}</a>{locale === "en" ? "." : "。"}</p>}
              </details>
            ))}
          </div>
        </div>
      </div>

      <h2>{t["lists.current"]}</h2>
      <p>{t["lists.current.lead"]}</p>
      {failed && <p class="error" role="alert">{t["lists.failed"]}</p>}
      <div class="lists-groups" data-testid="lists-groups" aria-busy={!summary && !failed}>
        {GROUPS.map((group) => (
          <section class={`lists-group lists-group--${group.key}`} aria-labelledby={`lists-group-${group.key}`}>
            <h3 class="lists-group__title" id={`lists-group-${group.key}`}>{t[`lists.group.${group.key}`]}</h3>
            <ul class="plain lists-cards">
              {group.lists.map((l) => (
                <li class="card card--flat lists-card" data-testid={`list-${l.id}`}>
                  <p class="lists-card__name">{t[`lists.${l.id}.title`]}</p>
                  <p class="muted small">{fmt(t["lists.card.by"], { who: t[`lists.${l.id}.by`] })}</p>
                  <p class="muted small">
                    {t["lists.card.source"]}<a href={l.href} target="_blank" rel="noopener">{t[`lists.${l.id}.name`]}</a>
                  </p>
                  <p class="lists-card__count">
                    <span class="lists-card__number">{count(row(l.id)?.domains)}</span>
                    <span class="muted small">{t["lists.card.domains"]}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p data-testid="list-quad9">
        {t["lists.quad9.before"]}<a href="https://quad9.net/result/" target="_blank" rel="noopener">{t["lists.quad9.name"]}</a>{t["lists.quad9.after"]}
      </p>
      {summary && <p class="muted small" data-testid="lists-as-of">{fmt(t["lists.asOf"], { time: formatTime(locale, summary.as_of) })}</p>}

      <div class="lists-cols">
        <div class="lists-col" data-testid="lists-col-how">
          <h2>{t["lists.gov.title"]}</h2>
          <p>{t["lists.gov.1"]}</p>
          <p>{t["lists.gov.2"]}</p>
          <p>{t["lists.gov.3"]}</p>
          <p>{t["lists.gov.none"]}</p>
        </div>
        <div class="lists-col" data-testid="lists-col-problems">
          <h2>{t["lists.rules.title"]}</h2>
          <ul>
            {RULES.map((n) => <li>{t[`lists.rules.${n}` as MessageKey]}</li>)}
          </ul>
          <p>
            {t["lists.rules.who"]}<a href={`mailto:${CONTACT}`}>{CONTACT}</a>{t["lists.rules.who.after"]}
          </p>
        </div>
      </div>

      <h2>{t["lists.coverage.title"]}</h2>
      <p class="lists-prose">{t["lists.coverage.lead"]}</p>
      <div class="lists-compare-wrap">
        {/* explicit roles: on phones the CSS makes the rows blocks, and browsers then drop the table's semantics */}
        <table role="table" class="lists-compare" data-testid="lists-compare">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">{t["lists.compare.kind"]}</th>
              <th role="columnheader" scope="col">Vessel {t["filter.malware"]}</th>
              <th role="columnheader" scope="col">Vessel {t["filter.ads"]}</th>
              <th role="columnheader" scope="col">Cloudflare <code>1.1.1.2</code></th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {COMPARE.map(([row, malware, ads, cloudflare]) => (
              <tr role="row">
                <th role="rowheader" scope="row">{t[`lists.compare.${row}`]}</th>
                <td role="cell" class="lists-compare__vessel" data-label={`Vessel ${t["filter.malware"]}`}>{malware}</td>
                <td role="cell" class="lists-compare__vessel" data-label={`Vessel ${t["filter.ads"]}`}>{ads}</td>
                <td role="cell" data-label="Cloudflare 1.1.1.2">{cloudflare}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul class="lists-prose">
        <li>{t["lists.coverage.phishing"]}</li>
        <li>{t["lists.coverage.taiwan"]}</li>
        <li>{t["lists.coverage.stalkerware"]}</li>
        <li>{t["lists.coverage.tracking"]}</li>
      </ul>
      <h3 id="beyond-the-lists">{t["lists.protect.title"]}</h3>
      <p class="lists-prose">{t["lists.protect.lead"]}</p>
      <ul class="lists-prose" data-testid="lists-protect">
        {([1, 2, 3] as const).map((n) => <li>{t[`lists.protect.${n}`]}</li>)}
      </ul>
      <p class="lists-prose">{t["lists.coverage.2"]}</p>
      <p class="lists-prose">{t["lists.coverage.3"]}<a href={href("/dns/")}>{t["dns.title"]}</a>{t["lists.coverage.3after"]}</p>
      <p class="lists-prose">
        {t["lists.coverage.risky"]}<a href={href(`/faq/#${faqAnchor("risky")}`)}>{t["lists.coverage.riskyLink"]}</a>{locale === "en" ? "." : "。"}
      </p>

      <details class="lists-more" data-testid="lists-more">
        <summary>{t["lists.more.title"]}</summary>
        <h2>{t["lists.measure.title"]}</h2>
        <p class="lists-prose">{t["lists.measure.lead"]}</p>
        <HatchDefs />
        <ul class="plain lists-chart__legend">
          <li><span class="lists-key lists-key--first" aria-hidden="true" />Vessel</li>
          <li>
            <svg class="lists-key" width="12" height="12" aria-hidden="true"><rect width="12" height="12" fill={`url(#${HATCH})`} /></svg>
            {t["lists.measure.others"]}
          </li>
        </ul>
        <div class="lists-panels" data-testid="lists-phishing">
          {PHISHING.map(([source, sites, malware, ads, cloudflare]) => (
            <figure class="lists-chart">
              <figcaption class="lists-chart__title">
                {t[`lists.measure.${source}`]}
                <span class="muted small"> · {fmt(t["lists.measure.sites"], { n: formatCount(locale, sites) })}</span>
              </figcaption>
              <ul class="plain lists-chart__bars">
                {([[`Vessel ${t["filter.malware"]}`, malware, true], [`Vessel ${t["filter.ads"]}`, ads, true], ["Cloudflare 1.1.1.2", cloudflare, false]] as const).map(([name, value, vessel]) => (
                  <li>
                    <div class="lists-bar__head"><span>{name}</span><span class="lists-bar__value">{value}%</span></div>
                    <ShareBar label={name} value={value} vessel={vessel} />
                  </li>
                ))}
              </ul>
            </figure>
          ))}
        </div>
        <ul class="lists-prose">
          <li>{t["lists.measure.how"]}</li>
          <li>{t["lists.measure.bias"]}</li>
          <li>{t["lists.measure.other"]}</li>
          <li>{t["lists.measure.taiwan"]}</li>
          <li>{t["lists.measure.date"]}</li>
        </ul>
        <div class="lists-cols">
          <div class="lists-col">
            <h2>{t["lists.share.title"]}</h2>
            {summary ? (
              <p data-testid="lists-share">
                {fmt(t["lists.share.filters"], {
                  malware: formatCount(locale, summary.malware_filter),
                  ads: formatCount(locale, summary.ads_filter),
                  hagezi: String(Math.round((summary.hagezi / Math.max(summary.ads_filter, 1)) * 100)),
                })}
              </p>
            ) : (
              !failed && <p><SkLine w="long" /></p>
            )}
            {!failed && (
              <figure class="lists-chart" data-testid="lists-chart-overlap">
                <figcaption class="lists-chart__title">{t["lists.chart.overlap"]}</figcaption>
                <ul class="plain lists-chart__legend">
                  <li><span class="lists-key lists-key--first" aria-hidden="true" />{t["lists.chart.only"]}</li>
                  <li>
                    <svg class="lists-key" width="12" height="12" aria-hidden="true"><rect width="12" height="12" fill={`url(#${HATCH})`} /></svg>
                    {t["lists.chart.shared"]}
                  </li>
                </ul>
                <ul class="plain lists-chart__bars">
                  {byDomains.map((l) => {
                    const r = row(l.id);
                    const name = t[`lists.${l.id}.title`];
                    const most = summary ? Math.max(...summary.lists.map((x) => x.domains)) : 1;
                    return (
                      <li>
                        <div class="lists-bar__head">
                          <span>{name}</span>
                          <span class="lists-bar__value">
                            {count(r?.domains)}
                            {r && r.domains > 0 && (
                              // rounded down: 100% only when a list really shares nothing
                              <span class="muted"> · {fmt(t["lists.chart.uniqueShare"], { pct: String(Math.floor((r.only_here / r.domains) * 100)) })}</span>
                            )}
                          </span>
                        </div>
                        {r ? (
                          <Bar
                            label={fmt(t["lists.chart.aria"], { name, total: formatCount(locale, r.domains), only: formatCount(locale, r.only_here) })}
                            first={r.only_here}
                            rest={r.domains - r.only_here}
                            of={most}
                            firstName={`${t["lists.chart.only"]}: ${formatCount(locale, r.only_here)}`}
                            restName={`${t["lists.chart.shared"]}: ${formatCount(locale, r.domains - r.only_here)}`}
                          />
                        ) : <SkLine />}
                      </li>
                    );
                  })}
                </ul>
              </figure>
            )}
            <p>{t["lists.share.size"]}</p>
          </div>

          <div class="lists-col">
            <h2>{t["lists.known.title"]}</h2>
            <p>{t["lists.known.lead"]}</p>
            <ul>
              {KNOWN.map((n) => <li>{t[`lists.known.${n}` as MessageKey]}</li>)}
            </ul>

            <h2>{t["lists.exclude.title"]}</h2>
            <p>
              {t["lists.exclude.body"]}<a href={EXCLUDE_FILE} target="_blank" rel="noopener">{t["lists.exclude.file"]}</a>
              {t["lists.exclude.after"]}
            </p>
            <div class="table-wrap legal">
              {/* explicit roles: on phones the CSS makes the rows blocks, and browsers then drop the table's semantics */}
              <table role="table" data-testid="lists-excluded">
                <thead role="rowgroup">
                  <tr role="row">
                    <th role="columnheader" scope="col">{t["lists.exclude.col.domain"]}</th>
                    <th role="columnheader" scope="col">{t["lists.exclude.col.reason"]}</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {EXCLUDED.map(([domain, reason]) => (
                    <tr role="row">
                      <td role="cell" data-label={t["lists.exclude.col.domain"]}><code>{domain}</code></td>
                      <td role="cell" data-label={t["lists.exclude.col.reason"]}>{t[`lists.exclude.${reason}`]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2>{t["lists.log.title"]}</h2>
            <ul class="plain stack" data-testid="lists-log">
              {LOG.map(([date, key]) => (
                <li><span class="muted small">{date}</span> {t[`lists.log.${key}`]}</li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}
