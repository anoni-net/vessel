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
          <p>{t["lists.share.size"]}</p>
          <p>{t["lists.share.categories"]}</p>

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
