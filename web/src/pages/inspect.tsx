import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, type Inspection, type Me, api, last } from "../api.ts";
import { announce } from "../announce.ts";
import { useCtx } from "../context.ts";
import { formatBytes, formatCount, formatDate, formatDay, formatStamp, formatTime } from "../format.ts";
import { focusLater } from "../focus.ts";
import { errorText, fmt } from "../i18n/index.ts";
import { Icon } from "../icons.tsx";
import { type Kept, type Sealed, forget, isKey, keep, kept, newKey, openReport } from "../inspection-key.ts";
import { navigate } from "../router.ts";
import { saveFile } from "../save-file.ts";
import { setSignedIn } from "../session.ts";
import { qrSvg } from "../wgconfig.ts";
import { AccountNav } from "./account.tsx";
import { Busy, SkButton, SkCard, SkLine, Spin } from "./skeleton.tsx";

const WAITING_EVERY = 10_000;
const RUNNING_EVERY = 5 * 60_000;
/** From this much time left, the page says the confirmation link is about to run out and offers a new one (WCAG 2.2.1). */
export const CONFIRM_WARN_SECONDS = 5 * 60;

/** Where focus goes when what it was on is gone with the part of the page it was in (WCAG 2.4.3). */
const toHeading = () => focusLater(() => document.querySelector("main h1"), true);

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
  /**
   * A site on a list, or `bypass_dns` (no name, no hours). Reports made since 2026-11-10 count visits and add `hours`
   * (the UTC hours it was seen in, `YYYY-MM-DDTHH`, sorted) and `last`; older ones, still stored, have `first` instead.
   */
  findings?: { severity: "threat" | "check"; kind: string; name?: string; count: number; first?: number; last?: number; hours?: string[] }[];
  /** How many more of each kind the report leaves out (absent from reports made before it listed only the top ones). */
  more?: Record<string, number>;
  /** Older reports only: the names that could not be found. The page no longer shows them. */
  nx_names?: unknown;
}

/** The days an inspection runs, for the parts of the report drawn a day at a time; `now` while it is still running. */
export interface Span {
  start: Date | null;
  end: Date | null;
  now?: Date;
  /** which day of how many, while it runs */
  day?: number;
  days: number;
}

/**
 * The inspection's days from what the portal says about it; the report's own hours fill in what it does not. One ended
 * early ends where copying stopped (`stopped_at`, from portals that send it), so the days after it are not drawn as days
 * without a connection.
 */
export function spanOf(state: Inspection, partial = false): Span {
  const planned = state.ends_at ? new Date(state.ends_at) : null;
  const stopped = !partial && state.stopped_at ? new Date(state.stopped_at) : null;
  const end = planned && stopped && stopped < planned ? stopped : planned ?? stopped;
  const start = state.started_at ? new Date(state.started_at) : end ? new Date(end.getTime() - state.days * 86_400_000) : null;
  return { start, end, days: state.days, ...(partial && end ? { now: new Date(), day: progress(state).day } : {}) };
}

/** Which day of the inspection it is, on the visitor's clock: the third of seven. */
export function progress(state: Inspection) {
  const left = Math.ceil((new Date(state.ends_at!).getTime() - Date.now()) / 86_400_000);
  return { day: Math.min(state.days, Math.max(1, state.days - left + 1)), days: state.days };
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
  // a new error is a new element, so the same words twice are read again
  const [err, setErr] = useState<{ text: string; n: number } | null>(null);
  const [local, setLocal] = useState<Kept | null>(() => (id ? kept(id) : null));
  const [expired, setExpired] = useState(false);
  // what to say when the status changes because of what the person did here, in place of what the new status says
  const said = useRef<string | null>(null);
  const seen = useRef<Inspection["status"] | undefined>(undefined);

  const fail = (x: unknown) => {
    if (x instanceof ApiError && x.code === "signed_out") {
      setSignedIn(false);
      navigate(href("/login/"), true);
      return;
    }
    // the page stays as it was, with the error above it, so what was filled in is still there to try again
    setErr({ text: errorText(t, x instanceof ApiError ? x.code : "unknown"), n: Date.now() });
    focusLater(() => document.getElementById("inspect-error"), true);
  };
  const load = async () => {
    try {
      setState(await api.inspection(id));
      setErr(null);
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
  // a new status replaces most of the page: say what happened (WCAG 4.1.3), and take focus to the top of the page
  // if it was on something that is gone, a button pressed here or a part replaced by the update
  useEffect(() => {
    const was = seen.current;
    seen.current = status;
    if (!was || !status || was === status) return;
    // waiting for the device, then nothing, and not because of anything done here: the link ran out
    const lapsed = was === "confirming" && status === "none" && said.current === null;
    setExpired(lapsed);
    const words: Record<Inspection["status"], string> = {
      none: lapsed ? t["inspect.expired"] : t["inspect.said.deleted"],
      confirming: t["inspect.said.confirming"],
      active: t["inspect.said.active"],
      ending: t["inspect.ending"],
      ended: t["inspect.said.ended"],
    };
    announce(said.current ?? words[status]);
    said.current = null;
    toHeading();
  }, [status]);

  const back = <p class="small"><a href={href("/devices/")}>{t["inspect.back"]}</a></p>;
  const error = err && <p class="error" role="alert" id="inspect-error" key={err.n}>{err.text}</p>;
  if (!state) {
    if (error) {
      return (
        <section class="wrap narrow stack inspect-page">
          <AccountNav />
          <h1>{t["inspect.title"]}</h1>
          {error}
          {back}
        </section>
      );
    }
    return (
      <section class="wrap narrow stack inspect-page" aria-busy="true">
        <AccountNav />
        <h1>{t["inspect.title"]}</h1>
        <InspectSkeleton consent={!known?.inspection} />
        <Busy />
      </section>
    );
  }

  /** `words`: what to say once it is done, where the new status alone would not say it. */
  const stop = async (words?: string) => {
    said.current = words ?? null;
    try {
      await api.stopInspection(id);
      await load();
    } catch (x) {
      said.current = null;
      fail(x);
    }
  };
  const setKept = (next: Kept | null) => {
    if (next) keep(id, next);
    else forget(id);
    setLocal(next);
  };

  return (
    <section class="wrap narrow stack inspect-page">
      <AccountNav leader={me?.group?.role === "leader"} />
      <h1>{t["inspect.title"]}</h1>
      {name && <p class="lead">{fmt(t["inspect.device"], { name })}</p>}
      {error}
      {status === "none" && expired && <p class="card card--warn card--flat" data-testid="inspect-expired">{t["inspect.expired"]}</p>}
      {status === "none" && <Consent id={id} state={state} grouped={!!me?.group} setKept={setKept} reload={load} fail={fail} />}
      {status === "confirming" && <Confirming id={id} state={state} local={local} setKept={setKept} reload={load} fail={fail} stop={stop} />}
      {status === "active" && <Running state={state} local={local} setKept={setKept} name={name} stop={stop} />}
      {status === "ending" && <p class="card card--tint card--flat">{t["inspect.ending"]}</p>}
      {status === "ended" && <Ended state={state} local={local} setKept={setKept} name={name} stop={stop} />}
      {back}
    </section>
  );
}

/** The page while it loads, in the shape of the consent page unless this tab knows the device has an inspection. */
function InspectSkeleton({ consent }: { consent: boolean }) {
  return (
    <div class="stack inspect-wide" aria-hidden="true">
      <div class="sk-lead"><SkLine w="mid" big /></div>
      {consent ? (
        <>
          <div class="sk-intro stack"><SkLine /><SkLine /><SkLine w="long" /></div>
          <div class="inspect-pair inspect-wide">
            <SkCard size="collect" lines={["mid", "full", "long", "full", "long"]} />
            <SkCard size="handling" lines={["mid", "full", "long", "full", "long"]} />
          </div>
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
    <form class="stack inspect-wide" onSubmit={start} data-testid="inspect-consent">
      <p>{fmt(t["inspect.intro"], { days: state.days })}</p>
      {/* side by side on a wide screen: what is collected, then how it is handled, read left to right */}
      <div class="inspect-pair inspect-wide">
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

/**
 * Waiting for the device. No turning ring: it could turn for the half hour the link is good for, next to buttons
 * (WCAG 2.2.2). Before the link runs out, the page says so and offers a new one (WCAG 2.2.1).
 */
function Confirming({ id, state, local, setKept, reload, fail, stop }: {
  id: string; state: Inspection; local: Kept | null; setKept: (k: Kept) => void; reload: () => Promise<void>; fail: (x: unknown) => void;
  stop: (words?: string) => Promise<void>;
}) {
  const { t } = useCtx();
  const [busy, setBusy] = useState(false);
  const left = state.confirm_seconds;
  // only where the link is: elsewhere the key is not here to open the report, and starting again is the way
  const soon = !!local?.url && left !== undefined && left <= CONFIRM_WARN_SECONDS;
  const minutes = Math.max(1, Math.ceil((left ?? 0) / 60));
  useEffect(() => {
    if (soon) announce(fmt(t["inspect.confirm.soon"], { minutes }));
  }, [soon]);
  const renew = async () => {
    setBusy(true);
    try {
      const r = await api.renewInspection(id);
      setKept({ ...local!, url: r.url, minutes: r.minutes });
      await reload();
      announce(t["inspect.said.renewed"]);
      focusLater(() => document.querySelector('[data-testid="inspect-confirming"] h2'), true);
    } catch (x) {
      // run out meanwhile: the page goes back to the start and says why
      if (x instanceof ApiError && x.code === "inspection_expired") await reload();
      else fail(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="stack inspect-wide" data-testid="inspect-confirming">
      {soon && (
        <div class="card card--warn card--flat stack" data-testid="inspect-soon">
          <p>{fmt(t["inspect.confirm.soon"], { minutes })}</p>
          <button class="nb-button" type="button" onClick={renew} disabled={busy} aria-busy={busy}>
            {busy && <Spin />}{t["inspect.confirm.renew"]}
          </button>
        </div>
      )}
      <div class="inspect-pair inspect-pair--top inspect-wide">
        {local?.url ? (
          <div class="card card--tint card--flat stack">
            <h2>{t["inspect.confirm.title"]}</h2>
            <p>{fmt(t["inspect.confirm.body"], { minutes: local.minutes ?? 30 })}</p>
            <p class="inspect-link"><a href={local.url} data-testid="inspect-url">{local.url}</a></p>
            <div class="qr card inspect-qr" role="img" aria-label={t["inspect.confirm.qr"]} dangerouslySetInnerHTML={{ __html: qrSvg(local.url) }} />
            <p class="muted small">{t["inspect.confirm.waiting"]}</p>
          </div>
        ) : (
          <p class="card card--warn card--flat" data-testid="inspect-lost">{t["inspect.confirm.lost"]}</p>
        )}
        {local && <CopyKey value={local.key} />}
      </div>
      <button class="link-button" type="button" onClick={() => stop(t["inspect.said.cancelled"])}>{t["inspect.cancel"]}</button>
    </div>
  );
}

function Running({ state, local, setKept, name, stop }: {
  state: Inspection; local: Kept | null; setKept: (k: Kept) => void; name: string; stop: (words?: string) => Promise<void>;
}) {
  const { t, locale } = useCtx();
  const end = () => window.confirm(fmt(t["inspect.endConfirm"], { days: state.report_days })) && stop();
  const { day } = progress(state);
  return (
    <div class="stack inspect-wide" data-testid="inspect-running">
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
  state: Inspection; local: Kept | null; setKept: (k: Kept) => void; name: string; stop: (words?: string) => Promise<void>;
}) {
  const { t, locale } = useCtx();
  const remove = () => window.confirm(t["inspect.deleteConfirm"]) && stop(t["inspect.said.deleted"]);
  return (
    <div class="stack inspect-wide" data-testid="inspect-ended">
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
  const field = useRef<HTMLInputElement>(null);
  // a key typed here: the form gives way while the report opens, so focus has to be put back somewhere
  const tried = useRef(false);
  const sealed = state.report as unknown as Sealed;
  useEffect(() => {
    if (!local) return;
    openReport<Report>(sealed, local.key).then((r) => { setReport(r); setWrong(false); }).catch(() => setWrong(true));
  }, [state.report, local?.key]);
  useEffect(() => {
    if (!tried.current) return;
    if (report) {
      tried.current = false;
      announce(t["inspect.said.opened"]);
      toHeading();
    } else if (wrong) focusLater(() => field.current, true);
  }, [report, wrong]);

  // the key is here and the report is being opened: not the moment to ask for a key
  if (!report && local && !wrong) return <SkCard size="device" lines={["mid", "full", "long"]} />;
  if (!report) {
    return (
      <form class="card card--flat stack" data-testid="inspect-locked" onSubmit={(e) => {
        e.preventDefault();
        tried.current = true;
        if (isKey(typed.trim())) setKept({ key: typed.trim() });
        else setWrong(true);
      }}>
        <h2>{t["inspect.locked.title"]}</h2>
        <p class="small">{t["inspect.locked.body"]}</p>
        <label class="stack small">{t["inspect.locked.label"]}
          <input class="nb-input" ref={field} value={typed} autoComplete="off" spellcheck={false} onInput={(e) => setTyped(e.currentTarget.value)}
            aria-invalid={wrong} aria-describedby={wrong ? "inspect-key-wrong" : undefined} data-testid="inspect-key-input" />
        </label>
        {wrong && <p class="error" role="alert" id="inspect-key-wrong">{t["inspect.locked.wrong"]}</p>}
        <button class="nb-button" type="submit">{t["inspect.locked.open"]}</button>
      </form>
    );
  }
  const download = () => {
    const css = [...document.styleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)).join("\n");
    const body = area.current!.cloneNode(true) as HTMLElement;
    body.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
    const title = fmt(t["inspect.device"], { name });
    // the results so far: the file says so in its name, its title and its first lines, so it is not taken for the full report
    const heading = partial ? t["inspect.file.partialTitle"] : t["inspect.title"];
    const html = `<!doctype html><html lang="${document.documentElement.lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title><style>${css}</style><body><main class="wrap narrow stack inspect-page"><h1>${heading}</h1><p class="lead"></p>${partial ? '<p class="card card--warn card--flat" data-partial></p>' : ""}${body.outerHTML}</main></body></html>`;
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelector(".lead")!.textContent = title;
    const now = new Date();
    if (partial) doc.querySelector("[data-partial]")!.textContent = fmt(t["inspect.file.partial"], { time: formatStamp(locale, now), ...progress(state) });
    const day = now.toLocaleDateString("sv");
    const at = `${pad(now.getHours())}${pad(now.getMinutes())}`;
    saveFile(partial ? `vessel-inspection-${day}-${at}-in-progress.html` : `vessel-inspection-${day}.html`,
      new Blob([`<!doctype html>${doc.documentElement.outerHTML}`], { type: "text/html" }));
  };
  if (report.empty) return <p class="muted" data-testid="inspect-empty">{t["inspect.noneYet"]}</p>;
  return (
    <div class="stack inspect-wide">
      {!partial && <button class="nb-button nb-button--primary" type="button" onClick={download} data-testid="inspect-download">{t["inspect.download"]}</button>}
      <div ref={area} class="inspect-wide"><ReportView report={report} locale={locale} span={spanOf(state, partial)} /></div>
      {partial && (
        // below the report, as a link: the results so far are there to read, and ending early stays the one thing at the top
        <div class="inspect-partial">
          <p class="muted small" data-testid="inspect-delay">{t["inspect.partial"]}</p>
          <button class="link-button" type="button" onClick={download} data-testid="inspect-download">{t["inspect.downloadPartial"]}</button>
        </div>
      )}
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** An hour as the report writes it (UTC), as a moment; everything drawn from it is on the reader's clock. */
const atHour = (hour: string) => new Date(`${hour}:00:00Z`);
/** A moment's day on the reader's clock, `YYYY-MM-DD`. */
const dayOf = (at: Date) => at.toLocaleDateString("sv");
/** `2026-11-10` as `11/10`, as the rows of the hours are labelled. */
const short = (day: string) => day.slice(5).replace("-", "/");
/**
 * A day under the days drawn side by side: the day of the month alone on a phone, where `11/10` would not fit eight
 * across, and the full date on a wide screen (styles.css shows one or the other).
 */
const dayTag = (day: string) => [<span class="day-short">{Number(day.slice(8))}</span>, <span class="day-full">{short(day)}</span>];

/** The night hours shaded on the hours: 1 to 6 am, analyze.py's IDLE_HOURS. */
const NIGHT = (hour: number) => hour >= 1 && hour < 6;
/**
 * An hour that sent at least this much, and more than it received, is marked. A phone mostly receives: an hour the other
 * way round, beyond the size of a few photos sent in a chat, is worth a look. A backup or an upload the person made does
 * it too, which is why it is a mark on the hours and not a finding.
 */
export const UP_HEAVY_BYTES = 20e6;
const upHeavy = (h: { up: number; down: number }) => h.up >= UP_HEAVY_BYTES && h.up > h.down;
/**
 * Sites seen only within one day are said to have stopped once the device has had at least this many hours of traffic
 * after the last of them: enough of a day of use that "not seen again" means something.
 */
export const QUIET_HOURS = 6;
/** The rows of each kind drawn before the rest are folded away. */
export const TOP_ROWS = 3;
/** At most this many sites of a kind: analyze.py's MAX_FINDINGS, and older reports, still stored, list all of theirs. */
const MAX_LISTED = 30;

/** The report's hours on the reader's clock: a row a day, a cell an hour. */
export function hourGrid(hours: NonNullable<Report["hours"]>) {
  const cells = new Map<string, Map<number, { total: number; up: number; down: number; mark: "x" | "!" | null; heavy: boolean; at: Date }>>();
  for (const h of hours) {
    const at = atHour(h.hour);
    const day = dayOf(at);
    if (!cells.has(day)) cells.set(day, new Map());
    cells.get(day)!.set(at.getHours(), { total: h.up + h.down, up: h.up, down: h.down, mark: h.mark, heavy: upHeavy(h), at });
  }
  // a phone's hours run from a few KB to some GB, so the five steps are even on a log scale, between this report's
  // quietest and busiest hour
  const logs = hours.map((h) => h.up + h.down).filter((n) => n > 0).map(Math.log10);
  const low = Math.min(...logs);
  const span = Math.max(...logs) - low;
  const level = (total: number) => (total <= 0 ? 0 : span === 0 ? 3 : Math.max(1, Math.ceil(((Math.log10(total) - low) / span) * 5)));
  return { days: [...cells.keys()].sort(), cells, level };
}

/**
 * Every day of the inspection on the reader's clock, from the day it started to the day it ends, with the hours that had
 * traffic on each. Days the report has hours on are always in, so a report whose inspection the portal no longer
 * describes still has its days.
 */
export function inspectionDays(report: Report, span: Span) {
  const seen = new Set<string>();
  if (span.start && span.end) [span.start, new Date(span.end.getTime() - 1)].forEach((d) => seen.add(dayOf(d)));
  for (const h of report.hours ?? []) seen.add(dayOf(atHour(h.hour)));
  for (const f of report.findings ?? []) for (const h of f.hours ?? []) seen.add(dayOf(atHour(h)));
  const sorted = [...seen].sort();
  const days: string[] = [];
  if (sorted.length) {
    // at noon, so a change of summer time does not skip or repeat a day
    const d = new Date(`${sorted[0]}T12:00:00`);
    while (days.length < 31 && dayOf(d) <= sorted.at(-1)!) {
      days.push(dayOf(d));
      d.setDate(d.getDate() + 1);
    }
  }
  const connected = new Map<string, number>();
  for (const h of report.hours ?? []) {
    if (h.up + h.down <= 0) continue;
    const day = dayOf(atHour(h.hour));
    connected.set(day, (connected.get(day) ?? 0) + 1);
  }
  const today = span.now ? dayOf(span.now) : null;
  return { days, connected, today, future: (day: string) => today !== null && day > today };
}

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
      // reports made since the hours were added say when each site was seen; older ones are listed as they were
      dated: named.length > 0 && named.every((f) => Array.isArray(f.hours)),
    };
  });
}

/** When a site was seen: how many of its hours fell on each day, and over how many days and hours. */
export function seenWhen(f: NonNullable<Report["findings"]>[number]) {
  const perDay = new Map<string, number>();
  for (const h of f.hours ?? []) {
    const day = dayOf(atHour(h));
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  return { perDay, slots: f.hours?.length ?? 0, days: perDay.size, last: f.last ? new Date(f.last * 1000) : null };
}

/** A day's cell for one site: how many of its hours it was seen in, as one of three steps. */
const hitLevel = (n: number) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3);

type Verdict = "threat" | "check" | "clean";

/**
 * What the report comes to, and why, in a sentence. Where the report says when each site was seen, the sentence tells a
 * one-off (most likely an ad or a redirect met while browsing) from sites seen day after day (more like an app that
 * keeps connecting). Older reports do not say when, and the sentence only gives what was found and how much.
 */
export function judge(report: Report, t: ReturnType<typeof useCtx>["t"], locale: ReturnType<typeof useCtx>["locale"]) {
  const groups = findingGroups(report);
  const state: Verdict = groups.some((g) => g.severity === "threat") ? "threat" : groups.length ? "check" : "clean";
  if (state === "clean") return { state, reason: t["inspect.report.clean"], next: false };
  const n = (x: number) => formatCount(locale, x);
  const named = (report.findings ?? []).filter((f) => f.name);
  const bypass = groups.find((g) => g.kind === "bypass_dns");
  const sites = groups.filter((g) => g.kind !== "bypass_dns");
  const counted = { sites: n(sites.reduce((s, g) => s + g.sites, 0)), n: n(sites.reduce((s, g) => s + g.count, 0)) };
  // the hours the sites of one severity were seen in, on the reader's clock
  const hoursOf = (severity: "threat" | "check") => [...new Set(named.filter((f) => f.severity === severity).flatMap((f) => f.hours ?? []))].sort().map(atHour);
  const lastOf = (severity: "threat" | "check") => Math.max(...named.filter((f) => f.severity === severity).map((f) => f.last ?? 0));
  const dated = (severity: "threat" | "check") => groups.filter((g) => g.severity === severity && g.kind !== "bypass_dns").every((g) => g.dated);

  if (state === "threat") {
    const threats = groups.filter((g) => g.severity === "threat");
    if (!dated("threat")) {
      return { state, reason: fmt(t["inspect.reason.threatCount"], { sites: n(threats.reduce((s, g) => s + g.sites, 0)), n: n(threats.reduce((s, g) => s + g.count, 0)) }), next: true };
    }
    const hours = hoursOf("threat");
    const last = lastOf("threat");
    return {
      state,
      next: true,
      reason: fmt(t["inspect.reason.threat"], {
        days: n(new Set(hours.map(dayOf)).size), slots: n(hours.length),
        last: last ? formatTime(locale, new Date(last * 1000).toISOString()) : formatTime(locale, hours.at(-1)!.toISOString()),
      }),
    };
  }

  const also = bypass ? fmt(t["inspect.reason.alsoBypass"], { n: n(bypass.count) }) : "";
  if (!sites.length) return { state, reason: fmt(t["inspect.reason.bypass"], { n: n(bypass!.count) }), next: false };
  if (!dated("check")) return { state, reason: join(fmt(t["inspect.reason.count"], counted), also), next: false };
  const hours = hoursOf("check");
  const days = [...new Set(hours.map(dayOf))];
  // seen day after day: the same steps as for a known threat, starting from the apps
  if (days.length > 1) return { state, reason: join(fmt(t["inspect.reason.repeat"], { days: n(days.length), slots: n(hours.length) }), also), next: true };
  const date = short(days[0]);
  if (hours.length > 3) return { state, reason: join(fmt(t["inspect.reason.oneDay"], { date, slots: n(hours.length) }), also), next: false };
  const clock = hours.map((h) => h.getHours());
  const periods = [...new Set(clock.map(period))];
  const when = periods.length === 1
    ? fmt(t["inspect.when.period"], { date, period: t[`inspect.period.${periods[0]}`] })
    : fmt(t["inspect.when.range"], { date, from: `${pad(Math.min(...clock))}:00`, to: `${pad(Math.max(...clock) + 1)}:00` });
  const lastHit = hours.at(-1)!.getTime();
  const after = (report.hours ?? []).filter((h) => atHour(h.hour).getTime() > lastHit && h.up + h.down > 0).length;
  return { state, reason: join(fmt(t[after >= QUIET_HOURS ? "inspect.reason.onceQuiet" : "inspect.reason.onceLatest"], { when }), also), next: false };
}

const period = (hour: number) => (hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening");
// sentences end in their own full stop, so they are only put side by side (a space between them in English)
const join = (a: string, b: string) => (b ? `${a}${/[.!?]$/.test(a) ? " " : ""}${b}` : a);

function ReportView({ report, locale, span }: { report: Report; locale: ReturnType<typeof useCtx>["locale"]; span: Span }) {
  const { t } = useCtx();
  const [picked, setPicked] = useState("");
  const { cells, level } = hourGrid(report.hours ?? []);
  const groups = findingGroups(report);
  const { state, reason, next } = judge(report, t, locale);
  const week = inspectionDays(report, span);
  const kind = (id: string) => t[`inspect.kind.${id}` as keyof typeof t] ?? id;
  const why = (id: string) => t[`inspect.why.${id}` as keyof typeof t] as string | undefined;
  const percent = (n: number) => `${Math.round(n * 100)}%`;
  const dayLabel = (day: string) => short(day);
  // how serious, in words as well as in the colour of the edge (WCAG 1.4.1)
  const severity = (s: "threat" | "check") => (
    <span class="strong" data-testid="inspect-severity">
      <span aria-hidden="true">{s === "threat" ? "× " : "! "}</span>
      {t[s === "threat" ? "inspect.report.markThreat" : "inspect.report.markCheck"]}
    </span>
  );
  const dot = <span aria-hidden="true"> · </span>;
  const line = (f: NonNullable<Report["findings"]>[number]) => (
    <li class={`inspect-finding inspect-finding--${f.severity}`} data-testid="inspect-finding">
      <code>{f.name}</code>
      <span class="muted small">
        {fmt(t["inspect.seen"], { n: formatCount(locale, f.count) })}
        {f.first ? ` ${fmt(t["inspect.firstSeen"], { time: formatTime(locale, new Date(f.first * 1000).toISOString()) })}` : ""}
      </span>
    </li>
  );
  // "seen on 2 of the 5 days with traffic": a day the device was not connected, or one still to come, is not a day the
  // site could have been seen on
  const online = week.days.filter((d) => week.connected.get(d)).length;
  const seenText = (f: NonNullable<Report["findings"]>[number]) => {
    const w = seenWhen(f);
    const n = (x: number) => formatCount(locale, x);
    const words = w.slots === 1 ? t["inspect.hits.once"]
      : w.days === 1 ? fmt(t["inspect.hits.oneDay"], { slots: n(w.slots) })
      : fmt(t["inspect.hits.days"], { total: n(Math.max(online, w.days)), days: n(w.days), slots: n(w.slots) });
    return { words, last: w.last ? fmt(t["inspect.hits.last"], { time: formatTime(locale, w.last.toISOString()) }) : "", w };
  };
  const hitCells = (perDay: Map<string, number>) => week.days.map((day) => {
    const n = perDay.get(day) ?? 0;
    const off = week.future(day) || !week.connected.get(day);
    return <span class={`hit hit--${n ? hitLevel(n) : off ? "off" : 0}`} />;
  });
  const hitRow = (f: NonNullable<Report["findings"]>[number]) => {
    const { words, last, w } = seenText(f);
    return (
      <li class="hit-row" data-testid="inspect-hit">
        <code class="hit-row__name">{f.name}</code>
        <span class="hit-row__cells hits__grid" aria-hidden="true">{hitCells(w.perDay)}</span>
        <span class="hit-row__words small" data-testid="inspect-hit-words">{words}{last && <>{dot}<span class="muted">{last}</span></>}</span>
      </li>
    );
  };
  const datedGroups = groups.filter((g) => g.dated);
  // the hours a day a row, on the same days as the bars at the top: a day without a connection keeps its row, and the
  // days still to come are left out
  const hourDays = week.days.filter((d) => !week.future(d));
  const coverage = report.coverage ?? { active_hours: 0, total_hours: 0 };

  return (
    <div class="stack inspect-report" id="inspection-report" data-testid="inspect-report">
      <div class={`card card--flat inspect-verdict inspect-verdict--${state}`} data-testid="inspect-verdict" data-state={state}>
        <div class="inspect-verdict__main">
          <p class="muted small">{t["inspect.verdict.title"]}</p>
          <h2 class="inspect-verdict__state">
            <Icon name={state === "threat" ? "cancel" : state === "check" ? "warning" : "ok"} />
            <span>{t[state === "threat" ? "inspect.report.markThreat" : state === "check" ? "inspect.report.markCheck" : "inspect.verdict.clean"]}</span>
          </h2>
          <p data-testid="inspect-reason">{reason}</p>
          {next && (
            <>
              <h3>{t["inspect.report.next"]}</h3>
              <ol class="inspect-list">
                {(["apps", "admin", "ask"] as const).map((k) => <li>{t[`inspect.report.next.${k}`]}</li>)}
              </ol>
            </>
          )}
        </div>
        {week.days.length > 0 && (
          <div class="inspect-cover" data-testid="inspect-cover">
            <h3>{t["inspect.cover.title"]}</h3>
            <p class="small">
              {fmt(t[span.day ? "inspect.cover.running" : "inspect.cover.done"], {
                day: span.day ?? 0, days: span.days, hours: formatCount(locale, coverage.active_hours),
                from: dayLabel(week.days[0]), to: dayLabel(week.days.at(-1)!),
              })}
            </p>
            <div class="cover" aria-hidden="true">
              {week.days.map((day) => {
                const hours = week.connected.get(day) ?? 0;
                return (
                  <span class={`cover__day${week.future(day) ? " cover__day--future" : ""}${day === week.today ? " cover__day--today" : ""}`}>
                    <span class="cover__meter"><span class="cover__fill" style={{ height: `${(hours / 24) * 100}%` }} /></span>
                    <span class="cover__label">{dayTag(day)}</span>
                  </span>
                );
              })}
            </div>
            <p class="muted small">{join(t["inspect.cover.note"], week.today ? t["inspect.cover.noteFuture"] : "")}</p>
            <details class="small">
              <summary>{t["inspect.report.table"]}</summary>
              <table class="inspect-table">
                <thead><tr><th>{t["inspect.cover.tableDay"]}</th><th>{t["inspect.cover.tableHours"]}</th></tr></thead>
                <tbody>{week.days.map((day) => (
                  <tr><td>{dayLabel(day)}{day === week.today ? ` ${t["inspect.cover.today"]}` : ""}</td>
                    <td>{week.future(day) ? t["inspect.cover.future"] : fmt(t["inspect.cover.hours"], { n: week.connected.get(day) ?? 0 })}</td></tr>
                ))}</tbody>
              </table>
            </details>
          </div>
        )}
      </div>

      {groups.length > 0 && (
        <div class="card card--flat stack inspect-findings">
          <h2>{t["inspect.report.findings"]}</h2>
          <ul class="plain stack" data-testid="inspect-summary">
            {groups.map((g) => (
              <li class={`inspect-finding inspect-finding--${g.severity} inspect-kind`} data-testid="inspect-kind">
                <h3 class="inspect-kind__name">{kind(g.kind)}</h3>
                <span class="muted small">
                  {severity(g.severity)}{dot}
                  {g.sites
                    ? fmt(t["inspect.report.sites"], { sites: formatCount(locale, g.sites), n: formatCount(locale, g.count) })
                    : fmt(t["inspect.seen"], { n: formatCount(locale, g.count) })}
                </span>
                {why(g.kind) && <span class="small" data-testid="inspect-why">{why(g.kind)}</span>}
                {g.dated ? (
                  <div class="hits" data-testid="inspect-hits">
                    <div class="hit-row hit-row--head" aria-hidden="true">
                      <span class="hit-row__cells hits__grid">{week.days.map((day) => <span class="hits__day">{dayTag(day)}</span>)}</span>
                    </div>
                    <ul class="plain hits__rows">{g.listed.slice(0, TOP_ROWS).map(hitRow)}</ul>
                    {g.listed.length > TOP_ROWS && (
                      <details class="small hits__more" data-testid="inspect-hits-more">
                        <summary>{fmt(t["inspect.hits.more"], { n: formatCount(locale, g.listed.length - TOP_ROWS) })}</summary>
                        <ul class="plain hits__rows">{g.listed.slice(TOP_ROWS).map(hitRow)}</ul>
                      </details>
                    )}
                    {g.hidden > 0 && <p class="muted small" data-testid="inspect-not-listed">{fmt(t["inspect.report.notListed"], { n: formatCount(locale, g.hidden), limit: MAX_LISTED })}</p>}
                  </div>
                ) : g.sites > 0 && (
                  <details key={g.kind} class="inspect-group small" open={g.severity === "threat"} data-testid="inspect-group">
                    <summary>{t["inspect.report.list"]} <span class="muted">{fmt(t["inspect.report.siteCount"], { n: formatCount(locale, g.sites) })}</span></summary>
                    <ul class="plain stack">{g.listed.map(line)}</ul>
                    {g.hidden > 0 && <p class="muted" data-testid="inspect-not-listed">{fmt(t["inspect.report.notListed"], { n: formatCount(locale, g.hidden), limit: MAX_LISTED })}</p>}
                  </details>
                )}
              </li>
            ))}
          </ul>
          {datedGroups.length > 0 && (
            <>
              <p class="inspect-legend small muted" data-testid="inspect-hits-legend">
                {(["off", "0", "1", "2", "3"] as const).map((k) => (
                  <span class="inspect-legend__item"><span class={`hit hit--${k}`} />{t[k === "off" ? "inspect.hits.offline" : k === "0" ? "inspect.hits.quiet" : `inspect.hits.level${k}` as const]}</span>
                ))}
              </p>
              <p class="muted small">{t["inspect.hits.note"]}</p>
              <details class="small">
                <summary>{t["inspect.report.table"]}</summary>
                <table class="inspect-table" data-testid="inspect-hits-table">
                  <thead><tr><th>{t["inspect.hits.tableSite"]}</th><th>{t["inspect.hits.tableWhen"]}</th><th>{t["inspect.hits.tableLast"]}</th></tr></thead>
                  <tbody>{datedGroups.flatMap((g) => [
                    <tr><th colSpan={3} scope="colgroup">{kind(g.kind)}</th></tr>,
                    ...g.listed.map((f) => {
                      const w = seenWhen(f);
                      return (
                        <tr><td><code>{f.name}</code></td>
                          <td>{[...w.perDay].map(([day, n]) => `${dayLabel(day)} (${n})`).join(", ")}</td>
                          <td>{w.last ? formatTime(locale, w.last.toISOString()) : ""}</td></tr>
                      );
                    }),
                  ])}</tbody>
                </table>
              </details>
            </>
          )}
        </div>
      )}

      <div class="card card--flat stack inspect-hours">
        <h2>{t["inspect.report.hours"]}</h2>
        <p class="muted small">{fmt(t["inspect.report.coverage"], { active: coverage.active_hours, total: coverage.total_hours })}</p>
        <div class="tiles" aria-hidden="true" data-testid="inspect-tiles">
          {hourDays.map((day) => !cells.has(day) ? (
            <div class="tiles__row tiles__row--off" data-day={day}>
              <span class="tiles__day">{dayLabel(day)}</span>
              <span class="tiles__off">{t["inspect.hits.offline"]}</span>
            </div>
          ) : (
            <div class="tiles__row" data-day={day}>
              <span class="tiles__day">{dayLabel(day)}</span>
              {Array.from({ length: 24 }, (_, hour) => {
                const c = cells.get(day)!.get(hour);
                const words = c ? `${dayLabel(day)} ${pad(hour)}:00  ↑${formatBytes(locale, c.up)} ↓${formatBytes(locale, c.down)}${c.heavy ? ` ${t["inspect.report.upMark"]}` : ""}` : "";
                // one sign to a square: a finding says more than the size of the hour, and the table has both
                const sign = c?.mark === "x" ? "×" : c?.mark === "!" ? "!" : c?.heavy ? "↑" : "";
                return (
                  <span class={`tile tile--${c ? level(c.total) : 0}${c?.mark === "x" ? " tile--threat" : c?.mark === "!" ? " tile--check" : c?.heavy ? " tile--up" : ""}${NIGHT(hour) ? " tile--night" : ""}`}
                    title={words} onClick={() => setPicked(words)}>{sign}</span>
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
        </p>
        <p class="inspect-legend small muted" data-testid="inspect-tiles-legend">
          <span class="inspect-legend__item"><span class="tile tile--3 tile--check">!</span>{t["inspect.report.markCheck"]}</span>
          <span class="inspect-legend__item"><span class="tile tile--3 tile--threat">×</span>{t["inspect.report.markThreat"]}</span>
          <span class="inspect-legend__item"><span class="tile tile--4 tile--up">↑</span>{fmt(t["inspect.report.upHeavy"], { mb: UP_HEAVY_BYTES / 1e6 })}</span>
          <span class="inspect-legend__item"><span class="tile tile--night-key" />{t["inspect.report.night"]}</span>
        </p>
        <details class="small">
          <summary>{t["inspect.report.table"]}</summary>
          <table class="inspect-table">
            <thead><tr><th>{t["inspect.report.tableHour"]}</th><th>{t["inspect.report.tableUp"]}</th><th>{t["inspect.report.tableDown"]}</th></tr></thead>
            <tbody data-testid="inspect-hours-table">{hourDays.flatMap((day) => {
              const hours = (report.hours ?? []).filter((h) => dayOf(atHour(h.hour)) === day);
              if (!hours.length) return [<tr><td>{dayLabel(day)}</td><td colSpan={2}>{t["inspect.hits.offline"]}</td></tr>];
              return hours.map((h) => {
                const at = atHour(h.hour);
                const marks = [h.mark === "x" ? t["inspect.report.markThreat"] : h.mark === "!" ? t["inspect.report.markCheck"] : "", upHeavy(h) ? t["inspect.report.upMark"] : ""].filter(Boolean);
                return <tr><td>{`${dayLabel(day)} ${pad(at.getHours())}:00${marks.length ? ` ${marks.join(", ")}` : ""}`}</td><td>{formatBytes(locale, h.up)}</td><td>{formatBytes(locale, h.down)}</td></tr>;
              });
            })}</tbody>
          </table>
        </details>
      </div>

      <div class="card card--flat stack inspect-checkcard">
        <h2>{t["inspect.report.checks"]}</h2>
        <ul class="plain inspect-checks" data-testid="inspect-checks">
          {report.checks?.map((c) => {
            const found = c.count > 0;
            const sev = !found ? "ok" : c.id === "stalkerware" ? "threat" : "check";
            const words = t[`inspect.check.${found ? "hit" : "ok"}.${c.id}` as keyof typeof t] ?? `${kind(c.id)}: ${found ? fmt(t["inspect.seen"], { n: c.count }) : t["inspect.report.notFound"]}`;
            return (
              <li class={`inspect-check inspect-check--${sev}`} data-testid="inspect-check" data-state={sev}>
                <Icon name={sev === "ok" ? "ok" : sev === "threat" ? "cancel" : "warning"} />
                <span>{words}</span>
              </li>
            );
          })}
        </ul>
        <details class="small" data-testid="inspect-figures">
          <summary>{t["inspect.check.details"]}</summary>
          <dl class="spec spec--figures">
            {report.checks?.map((c) => (
              <>
                <dt>{kind(c.id)}</dt>
                <dd>{c.count ? fmt(t["inspect.seen"], { n: formatCount(locale, c.count) }) : t["inspect.report.notFound"]}</dd>
              </>
            ))}
            <dt>{t["inspect.report.dns"]}</dt><dd>{formatCount(locale, report.dns?.total ?? 0)}</dd>
            <dt>{t["inspect.report.nx"]}</dt><dd>{percent(report.dns?.nx_share ?? 0)}</dd>
            <dt>{t["inspect.report.ads"]}</dt><dd>{percent(report.dns?.ads_share ?? 0)}</dd>
            <dt>{t["inspect.report.idle"]}</dt>
            {/* the share of a night is only a share of the nights there were: on the first day it says when it started */}
            <dd data-testid="inspect-idle">{coverage.total_hours >= 24 ? percent(report.idle_share ?? 0) : t["inspect.report.idleLater"]}</dd>
          </dl>
        </details>
      </div>
      <p class="muted small">{t["inspect.report.limits"]}</p>
    </div>
  );
}
