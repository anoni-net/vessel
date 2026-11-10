import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, type Inspection, type Me, api, last } from "../api.ts";
import { announce } from "../announce.ts";
import { useCtx } from "../context.ts";
import { formatBytes, formatCount, formatDate, formatDay, formatTime } from "../format.ts";
import { errorText, fmt } from "../i18n/index.ts";
import { type Kept, type Sealed, forget, isKey, keep, kept, newKey, openReport } from "../inspection-key.ts";
import { navigate } from "../router.ts";
import { saveFile } from "../save-file.ts";
import { setSignedIn } from "../session.ts";
import { qrSvg } from "../wgconfig.ts";
import { AccountNav } from "./account.tsx";
import { Busy, SkButton, SkCard, SkLine, Spin } from "./skeleton.tsx";

const WAITING_EVERY = 10_000;
const RUNNING_EVERY = 5 * 60_000;

/** What the analysis host writes (inspect/analyze.py, `report`). */
export interface Report {
  empty?: boolean;
  first?: number;
  last?: number;
  hours?: { hour: string; up: number; down: number; mark: "x" | "!" | null }[];
  coverage?: { active_hours: number; total_hours: number };
  dns?: { total: number; nx_share: number; ads_share: number };
  idle_share?: number;
  checks?: { id: string; count: number }[];
  findings?: { severity: "threat" | "check"; kind: string; name?: string; count: number; first?: number }[];
  /** How many more of each kind the report leaves out (absent from reports made before it listed only the top ones). */
  more?: Record<string, number>;
  nx_names?: { name: string; count: number }[];
}

const deviceId = () => (typeof location === "undefined" ? "" : new URLSearchParams(location.search).get("d") ?? "");

export function Inspect() {
  const { t, href } = useCtx();
  const id = deviceId();
  const [state, setState] = useState<Inspection | null>(null);
  // what this tab already knows from the devices page, so the name is there from the first frame
  const known = last.devices?.find((x) => x.id === id);
  const [name, setName] = useState(known?.name ?? "");
  const [me, setMe] = useState<Me | null>(last.me ?? null);
  const [err, setErr] = useState("");
  const [local, setLocal] = useState<Kept | null>(() => (id ? kept(id) : null));

  const fail = (x: unknown) => {
    if (x instanceof ApiError && x.code === "signed_out") {
      setSignedIn(false);
      navigate(href("/login/"), true);
    } else setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
  };
  const load = async () => {
    try {
      setState(await api.inspection(id));
    } catch (x) {
      fail(x);
    }
  };
  useEffect(() => {
    if (!id) return navigate(href("/devices/"), true);
    // all at once: a name arriving after the page is drawn would push everything down
    void Promise.all([api.inspection(id), api.me().catch(() => null), api.devices().catch(() => null)]).then(([s, m, d]) => {
      if (m) setMe(m);
      if (d) setName(d.find((x) => x.id === id)?.name ?? "");
      setState(s);
    }).catch(fail);
  }, []);

  const status = state?.status;
  // the report it opened is gone
  useEffect(() => {
    if (status === "none" && local) setKept(null);
  }, [status]);
  useEffect(() => {
    if (status !== "confirming" && status !== "ending" && status !== "active") return;
    const timer = setInterval(() => document.visibilityState === "visible" && load(), status === "active" ? RUNNING_EVERY : WAITING_EVERY);
    return () => clearInterval(timer);
  }, [status]);

  if (err) return <section class="wrap narrow"><p class="error" role="alert">{err}</p></section>;
  if (!state) {
    return (
      <section class="wrap narrow stack inspect-page" aria-busy="true">
        <AccountNav />
        <h1>{t["inspect.title"]}</h1>
        <InspectSkeleton consent={!known?.inspection} />
        <Busy />
      </section>
    );
  }

  const stop = async () => {
    try {
      await api.stopInspection(id);
      await load();
    } catch (x) {
      fail(x);
    }
  };
  const setKept = (next: Kept | null) => {
    if (next) keep(id, next);
    else forget(id);
    setLocal(next);
  };
  const back = <p class="small"><a href={href("/devices/")}>{t["inspect.back"]}</a></p>;

  return (
    <section class="wrap narrow stack inspect-page">
      <AccountNav leader={me?.group?.role === "leader"} />
      <h1>{t["inspect.title"]}</h1>
      {name && <p class="lead">{fmt(t["inspect.device"], { name })}</p>}
      {status === "none" && <Consent id={id} state={state} grouped={!!me?.group} setKept={setKept} reload={load} fail={fail} />}
      {status === "confirming" && <Confirming local={local} stop={stop} />}
      {status === "active" && <Running state={state} local={local} setKept={setKept} name={name} stop={stop} />}
      {status === "ending" && <p class="card card--tint card--flat"><Spin />{t["inspect.ending"]}</p>}
      {status === "ended" && <Ended state={state} local={local} setKept={setKept} name={name} stop={stop} />}
      {back}
    </section>
  );
}

/** The page while it loads, in the shape of the consent page unless this tab knows the device has an inspection. */
function InspectSkeleton({ consent }: { consent: boolean }) {
  return (
    <div class="stack" aria-hidden="true">
      <div class="sk-lead"><SkLine w="mid" big /></div>
      {consent ? (
        <>
          <div class="sk-intro stack"><SkLine /><SkLine /><SkLine w="long" /></div>
          <SkCard size="collect" lines={["mid", "full", "long", "full", "long"]} />
          <SkCard size="handling" lines={["mid", "full", "long", "full", "long"]} />
          <SkLine w="long" />
          <SkButton />
        </>
      ) : <SkCard size="device" lines={["mid", "full", "long"]} />}
    </div>
  );
}

function Consent({ state, grouped, id, setKept, reload, fail }: {
  state: Inspection; grouped: boolean; id: string; setKept: (k: Kept) => void; reload: () => Promise<void>; fail: (x: unknown) => void;
}) {
  const { t, href } = useCtx();
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const start = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { key, publicKey } = newKey();
      const r = await api.startInspection(id, { consent_version: state.consent_version, public_key: publicKey });
      setKept({ key, url: r.url, minutes: r.minutes });
      await reload();
    } catch (x) {
      fail(x);
    } finally {
      setBusy(false);
    }
  };
  const items = (["names", "where", "size", "packets", "plain"] as const).map((k) => t[`inspect.collect.${k}`]);
  return (
    <form class="stack" onSubmit={start} data-testid="inspect-consent">
      <p>{fmt(t["inspect.intro"], { days: state.days })}</p>
      <div class="card card--flat stack">
        <h2>{t["inspect.collect.title"]}</h2>
        <ul class="inspect-list">{items.map((x) => <li>{x}</li>)}</ul>
        <p class="muted small">{t["inspect.collect.not"]}</p>
      </div>
      <div class="card card--flat stack">
        <h2>{t["inspect.handling.title"]}</h2>
        <dl class="spec small">
          <dt>{t["inspect.handling.who"]}</dt><dd>{t["inspect.handling.whoValue"]}</dd>
          <dt>{t["inspect.handling.where"]}</dt><dd>{t["inspect.handling.whereValue"]}</dd>
          <dt>{t["inspect.handling.packets"]}</dt><dd>{t["inspect.handling.packetsValue"]}</dd>
          <dt>{t["inspect.handling.report"]}</dt><dd>{fmt(t["inspect.handling.reportValue"], { days: state.report_days })}</dd>
          <dt>{t["inspect.handling.stop"]}</dt><dd>{t["inspect.handling.stopValue"]}</dd>
        </dl>
        {grouped && <p class="small" data-testid="inspect-group">{t["inspect.handling.group"]}</p>}
        <p class="small"><a href={href("/privacy/#inspection")}>{t["inspect.handling.more"]}</a></p>
      </div>
      <label class="check">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.currentTarget.checked)} data-testid="inspect-agree" />
        {t["inspect.agree"]}
      </label>
      <button class="nb-button nb-button--primary" type="submit" disabled={!sure || busy} aria-busy={busy}>
        {busy && <Spin />}{t["inspect.start"]}
      </button>
    </form>
  );
}

function CopyKey({ value }: { value: string }) {
  const { t } = useCtx();
  const [can, setCan] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCan(typeof navigator.clipboard?.writeText === "function"), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      announce(t["invite.copied"]);
    } catch {
      /* the key is on screen to select */
    }
  };
  return (
    <div class="card card--flat stack" data-testid="inspect-key">
      <h2>{t["inspect.key.title"]}</h2>
      <p class="small">{t["inspect.key.body"]}</p>
      <code class="inspect-key">{value}</code>
      {can && <button class="nb-button" type="button" onClick={copy}>{copied ? t["invite.copied"] : t["inspect.key.copy"]}</button>}
    </div>
  );
}

function Confirming({ local, stop }: { local: Kept | null; stop: () => void }) {
  const { t } = useCtx();
  return (
    <div class="stack" data-testid="inspect-confirming">
      {local?.url ? (
        <div class="card card--tint card--flat stack">
          <h2>{t["inspect.confirm.title"]}</h2>
          <p>{fmt(t["inspect.confirm.body"], { minutes: local.minutes ?? 30 })}</p>
          <p class="inspect-link"><a href={local.url} data-testid="inspect-url">{local.url}</a></p>
          <div class="qr card inspect-qr" role="img" aria-label={t["inspect.confirm.qr"]} dangerouslySetInnerHTML={{ __html: qrSvg(local.url) }} />
          <p class="muted small"><Spin />{t["inspect.confirm.waiting"]}</p>
        </div>
      ) : (
        <p class="card card--warn card--flat" data-testid="inspect-lost">{t["inspect.confirm.lost"]}</p>
      )}
      {local && <CopyKey value={local.key} />}
      <button class="link-button" type="button" onClick={stop}>{t["inspect.cancel"]}</button>
    </div>
  );
}

function Running({ state, local, setKept, name, stop }: { state: Inspection; local: Kept | null; setKept: (k: Kept) => void; name: string; stop: () => void }) {
  const { t, locale } = useCtx();
  const end = () => window.confirm(fmt(t["inspect.endConfirm"], { days: state.report_days })) && stop();
  const left = Math.ceil((new Date(state.ends_at!).getTime() - Date.now()) / 86_400_000);
  const day = Math.min(state.days, Math.max(1, state.days - left + 1));
  return (
    <div class="stack" data-testid="inspect-running">
      <div class="card card--tint card--flat inspect-status" data-testid="inspect-status">
        <p class="strong">{fmt(t["inspect.runningDay"], { day, days: state.days })}</p>
        <div class="inspect-status__row">
          <span>{fmt(t["inspect.running"], { date: formatDay(locale, state.ends_at!) })}</span>
          <button class="link-button" type="button" onClick={end}>{t["inspect.end"]}</button>
        </div>
      </div>
      {state.report ? <Opened state={state} local={local} setKept={setKept} name={name} partial /> : <p class="muted">{t["inspect.noneYet"]}</p>}
      {local && <CopyKey value={local.key} />}
    </div>
  );
}

function Ended({ state, local, setKept, name, stop }: {
  state: Inspection; local: Kept | null; setKept: (k: Kept) => void; name: string; stop: () => Promise<void>;
}) {
  const { t, locale } = useCtx();
  const remove = () => window.confirm(t["inspect.deleteConfirm"]) && stop();
  return (
    <div class="stack" data-testid="inspect-ended">
      <p class="card card--warn card--flat" data-testid="inspect-until">{fmt(t["inspect.keepUntil"], { date: formatDate(locale, state.report_until!) })}</p>
      {state.report ? <Opened state={state} local={local} setKept={setKept} name={name} /> : <p class="muted">{t["inspect.noneYet"]}</p>}
      <button class="link-button" type="button" onClick={remove}>{t["inspect.delete"]}</button>
    </div>
  );
}

/** The report, once a key opens it; asks for the key where this browser has none. */
function Opened({ state, local, setKept, name, partial }: { state: Inspection; local: Kept | null; setKept: (k: Kept) => void; name: string; partial?: boolean }) {
  const { t, locale } = useCtx();
  const [report, setReport] = useState<Report | null>(null);
  const [wrong, setWrong] = useState(false);
  const [typed, setTyped] = useState("");
  const area = useRef<HTMLDivElement>(null);
  const sealed = state.report as unknown as Sealed;
  useEffect(() => {
    if (!local) return;
    openReport<Report>(sealed, local.key).then((r) => { setReport(r); setWrong(false); }).catch(() => setWrong(true));
  }, [state.report, local?.key]);

  // the key is here and the report is being opened: not the moment to ask for a key
  if (!report && local && !wrong) return <SkCard size="device" lines={["mid", "full", "long"]} />;
  if (!report) {
    return (
      <form class="card card--flat stack" data-testid="inspect-locked" onSubmit={(e) => { e.preventDefault(); if (isKey(typed.trim())) setKept({ key: typed.trim() }); else setWrong(true); }}>
        <h2>{t["inspect.locked.title"]}</h2>
        <p class="small">{t["inspect.locked.body"]}</p>
        <label class="stack small">{t["inspect.locked.label"]}
          <input class="nb-input" value={typed} autoComplete="off" spellcheck={false} onInput={(e) => setTyped(e.currentTarget.value)} data-testid="inspect-key-input" />
        </label>
        {wrong && <p class="error" role="alert">{t["inspect.locked.wrong"]}</p>}
        <button class="nb-button" type="submit">{t["inspect.locked.open"]}</button>
      </form>
    );
  }
  const download = () => {
    const css = [...document.styleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)).join("\n");
    const body = area.current!.cloneNode(true) as HTMLElement;
    body.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
    const title = fmt(t["inspect.device"], { name });
    const html = `<!doctype html><html lang="${document.documentElement.lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t["inspect.title"]}</title><style>${css}</style><body><main class="wrap narrow stack"><h1>${t["inspect.title"]}</h1><p class="lead"></p>${body.outerHTML}</main></body></html>`;
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelector(".lead")!.textContent = title;
    const day = new Date().toLocaleDateString("sv");
    saveFile(`vessel-inspection-${day}.html`, new Blob([`<!doctype html>${doc.documentElement.outerHTML}`], { type: "text/html" }));
  };
  if (report.empty) return <p class="muted" data-testid="inspect-empty">{t["inspect.noneYet"]}</p>;
  return (
    <div class="stack">
      {!partial && <button class="nb-button nb-button--primary" type="button" onClick={download} data-testid="inspect-download">{t["inspect.download"]}</button>}
      <div ref={area}><ReportView report={report} locale={locale} /></div>
      {partial && <p class="muted small" data-testid="inspect-delay">{t["inspect.partial"]}</p>}
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The report's hours on the reader's clock: a row a day, a cell an hour. */
export function hourGrid(hours: NonNullable<Report["hours"]>) {
  const cells = new Map<string, Map<number, { total: number; up: number; down: number; mark: "x" | "!" | null; at: Date }>>();
  for (const h of hours) {
    const at = new Date(`${h.hour}:00:00Z`);
    const day = at.toLocaleDateString("sv");
    if (!cells.has(day)) cells.set(day, new Map());
    cells.get(day)!.set(at.getHours(), { total: h.up + h.down, up: h.up, down: h.down, mark: h.mark, at });
  }
  // a phone's hours run from a few KB to some GB, so the five steps are even on a log scale, between this report's
  // quietest and busiest hour
  const logs = hours.map((h) => h.up + h.down).filter((n) => n > 0).map(Math.log10);
  const low = Math.min(...logs);
  const span = Math.max(...logs) - low;
  const level = (total: number) => (total <= 0 ? 0 : span === 0 ? 3 : Math.max(1, Math.ceil(((Math.log10(total) - low) / span) * 5)));
  return { days: [...cells.keys()].sort(), cells, level };
}

/** At most this many sites of a kind: analyze.py's MAX_FINDINGS, and older reports, still stored, list all of theirs. */
const MAX_LISTED = 30;

/** The findings by kind, threats first: what was found comes before the sites it was found on. */
export function findingGroups(report: Report) {
  const byKind = new Map<string, NonNullable<Report["findings"]>>();
  const all = report.findings ?? [];
  for (const f of [...all.filter((x) => x.severity === "threat"), ...all.filter((x) => x.severity === "check")]) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind)!.push(f);
  }
  return [...byKind].map(([kind, items]) => {
    const named = items.filter((f) => f.name);
    const left = report.more?.[kind] ?? 0;
    return {
      kind,
      severity: items[0].severity,
      count: report.checks?.find((c) => c.id === kind)?.count ?? items.reduce((sum, f) => sum + f.count, 0),
      sites: named.length + left,
      listed: named.slice(0, MAX_LISTED),
      hidden: Math.max(0, named.length - MAX_LISTED) + left,
    };
  });
}

function ReportView({ report, locale }: { report: Report; locale: ReturnType<typeof useCtx>["locale"] }) {
  const { t } = useCtx();
  const [picked, setPicked] = useState("");
  const { days, cells, level } = hourGrid(report.hours ?? []);
  const groups = findingGroups(report);
  const threats = groups.some((g) => g.severity === "threat");
  const withSites = groups.filter((g) => g.sites > 0);
  const kind = (id: string) => t[`inspect.kind.${id}` as keyof typeof t] ?? id;
  const percent = (n: number) => `${Math.round(n * 100)}%`;
  const line = (f: NonNullable<Report["findings"]>[number]) => (
    <li class={`inspect-finding inspect-finding--${f.severity}`} data-testid="inspect-finding">
      <code>{f.name}</code>
      <span class="muted small">
        {fmt(t["inspect.seen"], { n: formatCount(locale, f.count) })}
        {f.first ? ` ${fmt(t["inspect.firstSeen"], { time: formatTime(locale, new Date(f.first * 1000).toISOString()) })}` : ""}
      </span>
    </li>
  );
  return (
    <div class="stack" id="inspection-report" data-testid="inspect-report">
      {groups.length > 0 ? (
        <div class="card card--flat stack">
          <h2>{t["inspect.report.findings"]}</h2>
          <ul class="plain stack" data-testid="inspect-summary">
            {groups.map((g) => (
              <li class={`inspect-finding inspect-finding--${g.severity}`}>
                <span class="strong">{kind(g.kind)}</span>
                <span class="muted small">
                  {g.sites
                    ? fmt(t["inspect.report.sites"], { sites: formatCount(locale, g.sites), n: formatCount(locale, g.count) })
                    : fmt(t["inspect.seen"], { n: formatCount(locale, g.count) })}
                </span>
              </li>
            ))}
          </ul>
          {threats && (
            <>
              <h3>{t["inspect.report.next"]}</h3>
              <ol class="inspect-list">
                {(["apps", "admin", "ask"] as const).map((k) => <li>{t[`inspect.report.next.${k}`]}</li>)}
              </ol>
            </>
          )}
          {withSites.length > 0 && <h3>{t["inspect.report.list"]}</h3>}
          {withSites.map((g) => (
            <details key={g.kind} class="inspect-group small" open={g.severity === "threat"} data-testid="inspect-group">
              <summary>{kind(g.kind)} <span class="muted">{fmt(t["inspect.report.siteCount"], { n: formatCount(locale, g.sites) })}</span></summary>
              <ul class="plain stack">{g.listed.map(line)}</ul>
              {g.hidden > 0 && <p class="muted" data-testid="inspect-not-listed">{fmt(t["inspect.report.notListed"], { n: formatCount(locale, g.hidden), limit: MAX_LISTED })}</p>}
            </details>
          ))}
        </div>
      ) : <p class="card card--tint card--flat" data-testid="inspect-clean">{t["inspect.report.clean"]}</p>}

      <div class="card card--flat stack">
        <h2>{t["inspect.report.hours"]}</h2>
        <p class="muted small">{fmt(t["inspect.report.coverage"], { active: report.coverage?.active_hours ?? 0, total: report.coverage?.total_hours ?? 0 })}</p>
        <div class="tiles" aria-hidden="true" data-testid="inspect-tiles">
          {days.map((day) => (
            <div class="tiles__row">
              <span class="tiles__day">{day.slice(5).replace("-", "/")}</span>
              {Array.from({ length: 24 }, (_, hour) => {
                const c = cells.get(day)!.get(hour);
                const words = c ? `${day.slice(5).replace("-", "/")} ${pad(hour)}:00  ↑${formatBytes(locale, c.up)} ↓${formatBytes(locale, c.down)}` : "";
                return (
                  <span class={`tile tile--${c ? level(c.total) : 0}${c?.mark === "x" ? " tile--threat" : c?.mark === "!" ? " tile--check" : ""}`}
                    title={words} onClick={() => setPicked(words)}>{c?.mark === "x" ? "×" : c?.mark === "!" ? "!" : ""}</span>
                );
              })}
            </div>
          ))}
          <div class="tiles__row tiles__axis" aria-hidden="true">
            <span class="tiles__day" />
            {Array.from({ length: 24 }, (_, hour) => <span>{hour % 6 === 0 ? hour : ""}</span>)}
          </div>
        </div>
        {picked && <p class="small" data-testid="inspect-picked">{picked}</p>}
        <p class="inspect-legend small muted">
          {t["inspect.report.less"]}
          {[1, 2, 3, 4, 5].map((n) => <span class={`tile tile--${n}`} />)}
          {t["inspect.report.more"]}
          <span class="tile tile--3 tile--check">!</span>{t["inspect.report.markCheck"]}
          <span class="tile tile--3 tile--threat">×</span>{t["inspect.report.markThreat"]}
        </p>
        <details class="small">
          <summary>{t["inspect.report.table"]}</summary>
          <table class="inspect-table">
            <thead><tr><th>{t["inspect.report.tableHour"]}</th><th>{t["inspect.report.tableUp"]}</th><th>{t["inspect.report.tableDown"]}</th></tr></thead>
            <tbody>{report.hours?.map((h) => {
              const at = new Date(`${h.hour}:00:00Z`);
              return <tr><td>{`${at.toLocaleDateString("sv").slice(5).replace("-", "/")} ${pad(at.getHours())}:00${h.mark ? ` ${h.mark === "x" ? t["inspect.report.markThreat"] : t["inspect.report.markCheck"]}` : ""}`}</td><td>{formatBytes(locale, h.up)}</td><td>{formatBytes(locale, h.down)}</td></tr>;
            })}</tbody>
          </table>
        </details>
      </div>

      <div class="card card--flat stack">
        <h2>{t["inspect.report.checks"]}</h2>
        <dl class="spec spec--figures small">
          {report.checks?.map((c) => (
            <>
              <dt>{kind(c.id)}</dt>
              <dd>{c.count ? fmt(t["inspect.seen"], { n: formatCount(locale, c.count) }) : t["inspect.report.notFound"]}</dd>
            </>
          ))}
          <dt>{t["inspect.report.dns"]}</dt><dd>{formatCount(locale, report.dns?.total ?? 0)}</dd>
          <dt>{t["inspect.report.nx"]}</dt><dd>{percent(report.dns?.nx_share ?? 0)}</dd>
          <dt>{t["inspect.report.ads"]}</dt><dd>{percent(report.dns?.ads_share ?? 0)}</dd>
          <dt>{t["inspect.report.idle"]}</dt><dd>{percent(report.idle_share ?? 0)}</dd>
        </dl>
        {!!report.nx_names?.length && (
          <details class="small">
            <summary>{t["inspect.report.nxNames"]}</summary>
            <ul class="plain inspect-names">{report.nx_names.map((n) => <li><code>{n.name}</code> <span class="muted">{formatCount(locale, n.count)}</span></li>)}</ul>
          </details>
        )}
      </div>
      <p class="muted small">{t["inspect.report.limits"]}</p>
    </div>
  );
}
