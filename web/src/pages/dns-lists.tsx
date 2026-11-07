import { useEffect, useState } from "preact/hooks";
import { type BlocklistSummary, api } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatCount, formatTime } from "../format.ts";
import { type MessageKey, fmt } from "../i18n/index.ts";
import { SkLine } from "./skeleton.tsx";

const HAGEZI = "https://github.com/hagezi/dns-blocklists";
const LISTS = [
  { id: "malware", href: HAGEZI, used: "both" },
  { id: "tw165", href: "https://data.gov.tw/dataset/176455", used: "both" },
  { id: "twmoda", href: "https://data.gov.tw/dataset/165027", used: "both" },
  { id: "ads", href: HAGEZI, used: "ads" },
] as const;
const EXCLUDE_FILE = "https://github.com/anoni-net/vessel/blob/main/node/exclude.txt";
// the names in node/exclude.txt; tests/dns-lists.spec.ts checks that the two match
export const EXCLUDED = [
  ["from-ia.com", "suffix"],
  ["gomlab.com", "delisted"],
  ["playinfo.gomlab.com", "delisted"],
] as const;
// the 165 dataset by its 網站性質 field, December 2025 to September 2026; update with the text around the chart
const KINDS_165 = [
  ["finance", 50043],
  ["shopping", 26059],
  ["it", 11701],
  ["transport", 4697],
  ["other", 1339],
] as const;
const KINDS_165_TOTAL = 93839;
const RULES = [1, 2, 3, 4] as const;
const KNOWN = [1, 2, 3, 4] as const;
const RISKS = [1, 2, 3] as const;
// newest first; every change to the lists adds a line
const LOG = [
  ["2026-11-07", "20261107"],
  ["2026-11-01", "20261101b"],
  ["2026-11-01", "20261101a"],
  ["2026-10-31", "20261031"],
  ["2026-10-27", "20261027"],
] as const;

const pct = (n: number, of: number) => `${(n / Math.max(of, 1)) * 100}%`;

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
          <rect class="lists-bar__rest" x={`${start}%`} width={pct(rest, of)} height="14" rx="4"><title>{restName}</title></rect>
          <rect class="lists-bar__rest" x={`${start}%`} width="4" height="14" />
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

export function DnsLists() {
  const { t, locale, href } = useCtx();
  const [summary, setSummary] = useState<BlocklistSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.blocklistSummary().then(setSummary, () => setFailed(true));
  }, []);

  const row = (id: string) => summary?.lists.find((l) => l.id === id);
  const count = (n: number | undefined) =>
    n !== undefined ? formatCount(locale, n) : failed ? "–" : <SkLine w="short" />;

  return (
    <section class="wrap narrow stack lists-page">
      <h1>{t["lists.title"]}</h1>
      <p class="lead">{t["lists.lead"]}</p>

      <h2>{t["lists.current"]}</h2>
      {failed && <p class="error" role="alert">{t["lists.failed"]}</p>}
      <div class="table-wrap legal">
        <table data-testid="lists-table">
          <thead>
            <tr>
              {(["name", "maintainer", "blocks", "used", "domains", "only"] as const).map((c) => (
                <th scope="col" class={c === "domains" || c === "only" ? "lists-num" : undefined}>{t[`lists.col.${c}`]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LISTS.map((l) => (
              <tr>
                <td data-label={t["lists.col.name"]}>
                  <a href={l.href} target="_blank" rel="noopener">{t[`lists.${l.id}.name`]}</a>
                </td>
                <td data-label={t["lists.col.maintainer"]}>{t[`lists.${l.id}.by`]}</td>
                <td data-label={t["lists.col.blocks"]}>{t[`lists.${l.id}.blocks`]}</td>
                <td data-label={t["lists.col.used"]}>{t[`lists.used.${l.used}`]}</td>
                <td class="lists-num" data-label={t["lists.col.domains"]}>{count(row(l.id)?.domains)}</td>
                <td class="lists-num" data-label={t["lists.col.only"]}>{count(row(l.id)?.only_here)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {summary && <p class="muted small" data-testid="lists-as-of">{fmt(t["lists.asOf"], { time: formatTime(locale, summary.as_of) })}</p>}

      <div class="lists-cols">
        <div class="lists-col" data-testid="lists-col-how">
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
                <li><span class="lists-key lists-key--first" />{t["lists.chart.only"]}</li>
                <li><span class="lists-key lists-key--rest" />{t["lists.chart.shared"]}</li>
              </ul>
              <ul class="plain lists-chart__bars">
                {LISTS.map((l) => {
                  const r = row(l.id);
                  const name = t[`lists.chart.${l.id}`];
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
          <p>{t["lists.share.categories"]}</p>
          <figure class="lists-chart" data-testid="lists-chart-kinds">
            <figcaption class="lists-chart__title">{t["lists.chart.kinds"]}</figcaption>
            <ul class="plain lists-chart__bars">
              {KINDS_165.map(([kind, n]) => {
                const name = t[`lists.chart.kind.${kind}`];
                const share = `${Math.round((n / KINDS_165_TOTAL) * 100)}%`;
                return (
                  <li>
                    <div class="lists-bar__head">
                      <span>{name}</span>
                      <span class="lists-bar__value">{share}</span>
                    </div>
                    <Bar label={`${name} ${share}`} first={n} of={KINDS_165_TOTAL} firstName={`${formatCount(locale, n)}`} />
                  </li>
                );
              })}
            </ul>
          </figure>

          <h2>{t["lists.gov.title"]}</h2>
          <p>{t["lists.gov.body"]}</p>

          <h2>{t["lists.rules.title"]}</h2>
          <ul>
            {RULES.map((n) => <li>{t[`lists.rules.${n}` as MessageKey]}</li>)}
          </ul>
          <p class="muted small">{t["lists.rules.note"]}</p>

          <h2>{t["lists.risk.title"]}</h2>
          <ul>
            {RISKS.map((n) => <li>{t[`lists.risk.${n}` as MessageKey]}</li>)}
          </ul>
        </div>

        <div class="lists-col" data-testid="lists-col-problems">
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
            <table data-testid="lists-excluded">
              <thead>
                <tr>
                  <th scope="col">{t["lists.exclude.col.domain"]}</th>
                  <th scope="col">{t["lists.exclude.col.reason"]}</th>
                </tr>
              </thead>
              <tbody>
                {EXCLUDED.map(([domain, reason]) => (
                  <tr>
                    <td data-label={t["lists.exclude.col.domain"]}><code>{domain}</code></td>
                    <td data-label={t["lists.exclude.col.reason"]}>{t[`lists.exclude.${reason}`]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>{t["lists.wrong.title"]}</h2>
          <p>
            {t["lists.wrong.check"]}<a href={href("/dns/")}>{t["lists.wrong.checkLink"]}</a>{t["lists.wrong.checkAfter"]}
          </p>
          <p>
            {t["lists.wrong.report"]}<a href={href("/feedback/")}>{t["feedback.title"]}</a>{t["lists.wrong.reportAfter"]}
          </p>

          <h2>{t["lists.log.title"]}</h2>
          <ul class="plain stack" data-testid="lists-log">
            {LOG.map(([date, key]) => (
              <li><span class="muted small">{date}</span> {t[`lists.log.${key}`]}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
