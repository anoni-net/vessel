import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, type Device, type Inspection, type Me, api, last } from "../api.ts";
import { announce } from "../announce.ts";
import { useCtx } from "../context.ts";
import { formatBytes, formatCount, formatDate, formatDay, formatStamp, formatTime } from "../format.ts";
import { focusLater } from "../focus.ts";
import { errorText, fmt } from "../i18n/index.ts";
import { Icon } from "../icons.tsx";
import { type Kept, type Sealed, forget, isKey, keep, kept, newKey, openReport } from "../inspection-key.ts";
import { progress } from "../inspection-progress.ts";
import { flagOf } from "../regions.ts";
import { navigate } from "../router.ts";
import { saveFile } from "../save-file.ts";
import { setSignedIn } from "../session.ts";
import { NOTE_CATEGORIES, type SiteNote, noteFor } from "../site-notes.ts";
import { qrSvg } from "../wgconfig.ts";
import { AccountNav } from "./account.tsx";
import { Layers } from "./layers.tsx";
import { NoteCategories, NoteLine } from "./site-note.tsx";
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
  /** Reports made before 2026-11-12 also have `idle_share`, counted on Taiwan's clock; the share is now counted here. */
  checks?: { id: string; count: number }[];
  /**
   * A site on a list, or `bypass_dns` (no name; reports made since 2026-11-13 add its `hours` and `last`, as a site's).
   * Reports made since 2026-11-10 count visits and add `hours`
   * (the UTC hours it was seen in, `YYYY-MM-DDTHH`, sorted) and `last`; older ones, still stored, have `first` instead.
   * Reports made since the lists were compared one by one add `lists`: every list the site's names are on, its own `kind`
   * and the ad list included (`spyware`, `stalkerware`, `malware`, `cti`, `ads`, sorted). Without it, nothing is said about other lists.
   * A site's `name` is a list's entry: a domain, or since 2026-11-12 the address of a server a list knows by address alone.
   * A stalkerware site may also have `app`, the stalkerware it belongs to in Echap's stalkerware-indicators, and a spyware
   * site the investigation its indicator is from in MVT's index: names from outside, only ever put on the page as text.
   * Reports made since 2026-11-14 add `blocked` to a site: how many of its `count` visits Vessel's filter stopped, every
   * lookup of the visit answered by the node's lists. Absent where the inspection began before it was counted.
   */
  findings?: {
    severity: "threat" | "check"; kind: string; name?: string; count: number; first?: number; last?: number; hours?: string[]; lists?: string[]; app?: string;
    blocked?: number;
  }[];
  /**
   * When the oldest of the lists the device was compared with was downloaded (epoch seconds), as the report was made;
   * absent from older reports, and null while a list was missing.
   */
  lists_at?: number | null;
  /**
   * Connections without encryption (plain HTTP), each connection once, the system's own certificate and sign-in page
   * checks left out; no site or hour. Absent from reports of inspections that began before it was counted (2026-11-14).
   */
  plain?: number;
  /**
   * Connections that settled on SSL or TLS 1.0 or 1.1, each connection once; no site or hour. Absent from reports of
   * inspections that began before it was counted (2026-11-14).
   */
  old_tls?: number;
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


const deviceId = () => (typeof location === "undefined" ? "" : new URLSearchParams(location.search).get("d") ?? "");

export function Inspect() {
  const { t, href } = useCtx();
  const id = deviceId();
  const [state, setState] = useState<Inspection | null>(null);
  // what this tab already knows from the devices page, so the name is there from the first frame
  const known = last.devices?.find((x) => x.id === id);
  const [device, setDevice] = useState<Device | undefined>(known);
  const name = device?.name ?? "";
  const [me, setMe] = useState<Me | null>(last.me ?? null);
  // a new error is a new element, so the same words twice are read again
  const [err, setErr] = useState<{ text: string; n: number } | null>(null);
  const [local, setLocal] = useState<Kept | null>(() => (id ? kept(id) : null));
  const [expired, setExpired] = useState(false);
  // a leader's request is waiting, and the person chose an inspection of their own instead
  const [own, setOwn] = useState(false);
  // said no to a leader's request just now: the page says so above the person's own consent
  const [saidNo, setSaidNo] = useState(false);
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
      if (d) setDevice(d.find((x) => x.id === id));
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
        <InspectSkeleton status={known?.inspection ?? null} />
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
      {status === "active" ? (
        <div class="inspect-pair inspect-wide">
          {device && <DeviceLabel device={device} />}
          <RunningStatus state={state} stop={stop} />
        </div>
      ) : device && <DeviceLabel device={device} />}
      {error}
      {status === "none" && expired && <p class="card card--warn card--flat" data-testid="inspect-expired">{t["inspect.expired"]}</p>}
      {status === "none" && state.requested && !own
        ? <GroupConsent id={id} state={state} setKept={setKept} reload={load} fail={fail} own={() => setOwn(true)}
            declined={() => { setSaidNo(true); announce(t["inspect.group.declined"]); toHeading(); }} />
        : status === "none" && <Consent id={id} state={state} grouped={!!me?.group} setKept={setKept} reload={load} fail={fail} />}
      {status === "none" && saidNo && <p class="card card--tint card--flat" data-testid="inspect-declined">{t["inspect.group.declined"]}</p>}
      {status !== "none" && state.group && <p class="card card--tint card--flat small" data-testid="inspect-group-note">{t["inspect.group.note"]}</p>}
      {status === "confirming" && <Confirming id={id} state={state} local={local} setKept={setKept} reload={load} fail={fail} stop={stop} />}
      {status === "active" && <Running state={state} local={local} setKept={setKept} name={name} />}
      {status === "ending" && <p class="card card--tint card--flat">{t["inspect.ending"]}</p>}
      {status === "ended" && <Ended state={state} local={local} setKept={setKept} name={name} stop={stop} />}
      {status === "none" && state.requested && own && (
        <p class="small"><button class="link-button" type="button" onClick={() => setOwn(false)}>{t["inspect.group.back"]}</button></p>
      )}
      {back}
    </section>
  );
}

/**
 * The device under inspection as a drawing's label: its name large, then the node it goes out through and its filter,
 * the two that shape what the report can see. The words "device under inspection" are for screen readers, the frame
 * says DEVICE to the eye.
 */
function DeviceLabel({ device }: { device: Device }) {
  const { t } = useCtx();
  const flag = flagOf(device.region);
  return (
    <div class="inspect-device" data-testid="inspect-device">
      <p class="inspect-device__name"><span class="sr-only">{fmt(t["inspect.device"], { name: "" })}</span>{device.name}</p>
      <dl class="inspect-device__facts small">
        <div>
          <dt>{t["devices.spec.node"]}</dt>
          <dd class="spec__with-icon">
            {flag && <img class="flag flag--small" src={flag} alt="" width="20" height="15" />}
            <span>{t[`region.${device.region}` as keyof typeof t] ?? device.region}</span>
          </dd>
        </div>
        <div>
          <dt>{t["devices.spec.filter"]}</dt>
          <dd class="spec__with-icon"><Layers filter={device.dns_filter} small /><span>{t[`filter.${device.dns_filter}`]}</span></dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * The page while it loads, in the shape of the consent page unless this tab knows the device has an inspection; one that
 * is running has its status beside the device.
 */
function InspectSkeleton({ status }: { status: Device["inspection"] }) {
  const plate = (cls: string) => (
    <div class={cls}>
      <p class="inspect-device__name"><SkLine w="mid" big /></p>
      <div class="inspect-device__facts small"><SkLine w="long" /></div>
    </div>
  );
  return (
    <div class="stack inspect-wide" aria-hidden="true">
      {status === "active" ? <div class="inspect-pair inspect-wide">{plate("inspect-device")}{plate("inspect-device inspect-status")}</div> : plate("inspect-device")}
      {!status ? (
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

/**
 * A group's leader asked for an inspection of this device (toomore/anoni-net-ws#483). The same collection as one of the
 * person's own, and what the leaders will see of it: the verdict and the kinds of finding, never the sites, the counts
 * or the times. Saying no is as easy as saying yes, and the person can still have an inspection of their own instead.
 */
function GroupConsent({ state, id, setKept, reload, fail, own, declined }: {
  state: Inspection; id: string; setKept: (k: Kept) => void; reload: () => Promise<void>; fail: (x: unknown) => void;
  own: () => void; declined: () => void;
}) {
  const { t, href } = useCtx();
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState<"start" | "decline" | null>(null);
  const start = async (e: Event) => {
    e.preventDefault();
    setBusy("start");
    try {
      const { key, publicKey } = newKey();
      const r = await api.startInspection(id, { consent_version: state.group_consent_version!, public_key: publicKey, group: true });
      setKept({ key, url: r.url, minutes: r.minutes });
      await reload();
    } catch (x) {
      fail(x);
    } finally {
      setBusy(null);
    }
  };
  const decline = async () => {
    setBusy("decline");
    try {
      await api.declineInspection(id);
      await reload();
      declined();
    } catch (x) {
      fail(x);
    } finally {
      setBusy(null);
    }
  };
  const items = (["names", "where", "size", "packets", "plain"] as const).map((k) => t[`inspect.collect.${k}`]);
  const sees = (["verdict", "kinds", "days"] as const).map((k) => t[`inspect.group.sees.${k}`]);
  return (
    <form class="stack inspect-wide" onSubmit={start} data-testid="inspect-group-consent">
      <p class="card card--warn card--flat">{t["inspect.group.asked"]}</p>
      <p>{fmt(t["inspect.intro"], { days: state.days })}</p>
      <div class="inspect-pair inspect-wide">
        <div class="card card--flat stack">
          <h2>{t["inspect.collect.title"]}</h2>
          <ul class="inspect-list">{items.map((x) => <li>{x}</li>)}</ul>
          <p class="muted small">{t["inspect.collect.not"]}</p>
        </div>
        <div class="card card--flat stack" data-testid="inspect-group-sees">
          <h2>{t["inspect.group.sees.title"]}</h2>
          <ul class="inspect-list">{sees.map((x) => <li>{x}</li>)}</ul>
          <p class="small">{t["inspect.group.notSee"]}</p>
          <p class="small">{fmt(t["inspect.group.yours"], { days: state.report_days })}</p>
          <p class="small"><a href={href("/privacy/#inspection")}>{t["inspect.handling.more"]}</a></p>
        </div>
      </div>
      <label class="check">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.currentTarget.checked)} data-testid="inspect-agree" />
        {t["inspect.group.agree"]}
      </label>
      <button class="nb-button nb-button--primary" type="submit" disabled={!sure || !!busy} aria-busy={busy === "start"}>
        {busy === "start" && <Spin />}{t["inspect.start"]}
      </button>
      <button class="nb-button" type="button" onClick={decline} disabled={!!busy} aria-busy={busy === "decline"} data-testid="inspect-decline">
        {busy === "decline" && <Spin />}{t["inspect.group.decline"]}
      </button>
      <p class="small">{t["inspect.group.declineNote"]}</p>
      <p class="small"><button class="link-button" type="button" onClick={own}>{t["inspect.group.own"]}</button></p>
    </form>
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

/**
 * How far along a running inspection is, in the same frame as the device's label and beside it on a wide screen: the day
 * large, then under the hairline when it ends and the way to end it sooner. The frame says STATUS to the eye only.
 */
function RunningStatus({ state, stop }: { state: Inspection; stop: (words?: string) => Promise<void> }) {
  const { t, locale } = useCtx();
  const end = () => window.confirm(fmt(t["inspect.endConfirm"], { days: state.report_days })) && stop();
  const { day } = progress(state);
  return (
    <div class="inspect-device inspect-status" data-testid="inspect-status">
      <p class="inspect-device__name">{fmt(t["inspect.runningDay"], { day, days: state.days })}</p>
      <div class="inspect-device__facts inspect-status__row small">
        <span>{fmt(t["inspect.running"], { date: formatDay(locale, state.ends_at!) })}</span>
        <button class="link-button" type="button" onClick={end}>{t["inspect.end"]}</button>
      </div>
    </div>
  );
}

function Running({ state, local, setKept, name }: { state: Inspection; local: Kept | null; setKept: (k: Kept) => void; name: string }) {
  const { t } = useCtx();
  const key = local && <CopyKey value={local.key} />;
  return (
    <div class="stack inspect-wide" data-testid="inspect-running">
      {state.report ? <Opened state={state} local={local} setKept={setKept} name={name} partial aside={key} /> : <><p class="muted">{t["inspect.noneYet"]}</p>{key}</>}
    </div>
  );
}

function Ended({ state, local, setKept, name, stop }: {
  state: Inspection; local: Kept | null; setKept: (k: Kept) => void; name: string; stop: (words?: string) => Promise<void>;
}) {
  const { t, locale } = useCtx();
  // one a leader asked for: the leaders are told it was deleted, and nothing else
  const remove = () => window.confirm(t[state.group ? "inspect.group.deleteConfirm" : "inspect.deleteConfirm"]) && stop(t["inspect.said.deleted"]);
  return (
    <div class="stack inspect-wide" data-testid="inspect-ended">
      <p class="card card--warn card--flat" data-testid="inspect-until">{fmt(t["inspect.keepUntil"], { date: formatDate(locale, state.report_until!) })}</p>
      {state.report ? <Opened state={state} local={local} setKept={setKept} name={name} /> : <p class="muted">{t["inspect.noneYet"]}</p>}
      <button class="link-button" type="button" onClick={remove}>{t["inspect.delete"]}</button>
    </div>
  );
}

/**
 * The report, once a key opens it; asks for the key where this browser has none. `aside`: the card with the key, which
 * results so far put beside what is said under them.
 */
function Opened({ state, local, setKept, name, partial, aside }: {
  state: Inspection; local: Kept | null; setKept: (k: Kept) => void; name: string; partial?: boolean; aside?: ComponentChildren;
}) {
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
  if (!report && local && !wrong) return <><SkCard size="device" lines={["mid", "full", "long"]} />{aside}</>;
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
    // results so far say what a report cannot tell beside the key on the page; the file keeps it at the report's end
    if (partial) {
      const limits = document.createElement("p");
      limits.className = "muted small";
      limits.textContent = t["inspect.report.limits"];
      body.querySelector(".inspect-report")!.append(limits);
    }
    body.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
    // the file opens from the disk: a link to a page of the site keeps the site's address
    body.querySelectorAll<HTMLAnchorElement>('a[href^="/"]').forEach((a) => a.setAttribute("href", a.href));
    const title = fmt(t["inspect.device"], { name });
    // the results so far: the file says so in its name, its title and its first lines, so it is not taken for the full report
    const heading = partial ? t["inspect.file.partialTitle"] : t["inspect.title"];
    const html = `<!doctype html><html lang="${document.documentElement.lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title><style>${css}</style><body><main class="wrap narrow stack inspect-page"><h1>${heading}</h1><p class="lead" data-device></p>${partial ? '<p class="card card--warn card--flat" data-partial></p>' : ""}${body.outerHTML}</main></body></html>`;
    const doc = new DOMParser().parseFromString(html, "text/html");
    // the device's label as it is on the page, without the flag: the file opens offline and loads nothing from the site
    const label = document.querySelector<HTMLElement>("[data-testid=inspect-device]");
    const slot = doc.querySelector("[data-device]")!;
    if (label) {
      const copy = doc.importNode(label, true);
      copy.querySelectorAll("img").forEach((img) => img.remove());
      slot.replaceWith(copy);
    } else {
      slot.textContent = title;
    }
    const now = new Date();
    if (partial) doc.querySelector("[data-partial]")!.textContent = fmt(t["inspect.file.partial"], { time: formatStamp(locale, now), ...progress(state) });
    const day = now.toLocaleDateString("sv");
    const at = `${pad(now.getHours())}${pad(now.getMinutes())}`;
    saveFile(partial ? `vessel-inspection-${day}-${at}-in-progress.html` : `vessel-inspection-${day}.html`,
      new Blob([`<!doctype html>${doc.documentElement.outerHTML}`], { type: "text/html" }));
  };
  if (report.empty) return <><p class="muted" data-testid="inspect-empty">{t["inspect.noneYet"]}</p>{aside}</>;
  return (
    <div class="stack inspect-wide">
      {!partial && <button class="nb-button nb-button--primary" type="button" onClick={download} data-testid="inspect-download">{t["inspect.download"]}</button>}
      <div ref={area} class="inspect-wide"><ReportView report={report} locale={locale} span={spanOf(state, partial)} limits={!partial} /></div>
      {partial && (
        // below the report, as a link: the results so far are there to read, and ending early stays the one thing at the top.
        // The key first, on the left of a wide screen, then these words: in the order they are seen, on a phone too. Two
        // cards of a height: the key white, what to do; these tinted, what to know
        <div class="inspect-pair inspect-wide">
          {aside}
          <div class="card card--tint card--flat stack inspect-partial" data-testid="inspect-notes">
            <h2>{t["inspect.partial.title"]}</h2>
            <p class="small" data-testid="inspect-delay">{t["inspect.partial"]}</p>
            <p class="small">{t["inspect.report.limits"]}</p>
            <button class="link-button" type="button" onClick={download} data-testid="inspect-download">{t["inspect.downloadPartial"]}</button>
          </div>
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

/** The night hours, 1 to 6 am on the reader's clock: shaded on the hours, and the share of traffic in them. */
const NIGHT = (hour: number) => hour >= 1 && hour < 6;
/** The share of a report's traffic in the night hours, on the reader's clock, wherever the device was. */
function nightShare(hours: NonNullable<Report["hours"]>) {
  let night = 0;
  let total = 0;
  for (const h of hours) {
    total += h.up + h.down;
    if (NIGHT(atHour(h.hour).getHours())) night += h.up + h.down;
  }
  return total ? night / total : 0;
}
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

/**
 * Lists older than this when the report was made are said to be old: they are downloaded every 6 hours, and a capture is
 * only ever compared with the lists of the moment it was analysed.
 */
export const LISTS_OLD_SECONDS = 86_400;

/** The decades of bytes an hour's colours span, at most and at least: 3.5 is about 3,000 times between the ends. */
const SCALE_MAX = 3.5;
const SCALE_MIN = 2;

/** The report's hours on the reader's clock: a row a day, a cell an hour. */
export function hourGrid(hours: NonNullable<Report["hours"]>) {
  const cells = new Map<string, Map<number, { total: number; up: number; down: number; mark: "x" | "!" | null; heavy: boolean; at: Date }>>();
  for (const h of hours) {
    const at = atHour(h.hour);
    const day = dayOf(at);
    if (!cells.has(day)) cells.set(day, new Map());
    cells.get(day)!.set(at.getHours(), { total: h.up + h.down, up: h.up, down: h.down, mark: h.mark, heavy: upHeavy(h), at });
  }
  // a phone's hours run from a few KB to some GB, so the five steps are even on a log scale, up to this report's busiest
  // hour. The scale reaches down at most SCALE_MAX decades: a few hours of background KB would otherwise stretch it until
  // 7 MB and 120 MB share a colour. It spans at least SCALE_MIN decades, centred on the hours, so a device whose hours
  // are all about the same size is drawn in one colour rather than in all five.
  const logs = hours.map((h) => h.up + h.down).filter((n) => n > 0).map(Math.log10);
  let high = Math.max(...logs);
  let low = Math.max(Math.min(...logs), high - SCALE_MAX);
  const pad = Math.max(0, SCALE_MIN - (high - low)) / 2;
  low -= pad;
  high += pad;
  const level = (total: number) => (total <= 0 ? 0 : Math.min(5, Math.max(1, Math.ceil(((Math.log10(total) - low) / (high - low)) * 5))));
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

/** The lists a report can name, in the order they are written out: analyze.py's SOURCES. */
export const LISTS = ["spyware", "stalkerware", "malware", "cti", "ads"] as const;
/** The kinds that are a known threat when found: analyze.py's THREAT. */
export const THREAT_KINDS: readonly string[] = ["spyware", "stalkerware"];
type ListId = (typeof LISTS)[number];

/** The other lists a site is on, besides the one it was found on; none for a report from before `lists`. */
/** Whether Vessel blocked a site's visits, in words; null for a report that does not say. */
export function blockedWords(f: NonNullable<Report["findings"]>[number], t: ReturnType<typeof useCtx>["t"], locale: ReturnType<typeof useCtx>["locale"]) {
  if (f.blocked === undefined || !f.name) return null;
  if (f.blocked === 0) return t["inspect.blocked.none"];
  if (f.blocked >= f.count) return t[f.count === 1 ? "inspect.blocked.one" : "inspect.blocked.all"];
  return fmt(t["inspect.blocked.some"], { blocked: formatCount(locale, f.blocked), open: formatCount(locale, f.count - f.blocked) });
}

export function otherLists(f: NonNullable<Report["findings"]>[number]): ListId[] {
  return LISTS.filter((id) => id !== f.kind && f.lists?.includes(id));
}

/** "Also on the ad and tracking list", or "On 3 lists: …": what the lists themselves say about a site. */
export function alsoOn(f: NonNullable<Report["findings"]>[number], t: ReturnType<typeof useCtx>["t"]) {
  const others = otherLists(f);
  if (!others.length) return "";
  const name = (id: ListId) => t[`inspect.list.${id}`];
  if (others.length === 1) return fmt(t["inspect.lists.one"], { list: name(others[0]) });
  const all = LISTS.filter((id) => id === f.kind || others.includes(id));
  return fmt(t["inspect.lists.many"], { n: all.length, lists: all.map(name).join(t["inspect.lists.sep"]) });
}

/** Where the names of the stalkerware come from, and their licence (CC BY 4.0 asks for both). */
export const APPS_SOURCE = "https://github.com/AssoEchap/stalkerware-indicators";
export const APPS_LICENSE = "https://creativecommons.org/licenses/by/4.0/";

/** Where the spyware indicators come from: the index the Mobile Verification Toolkit keeps of published investigations. */
export const SPYWARE_SOURCE = "https://github.com/mvt-project/mvt-indicators";
/** Who to ask about a spyware indicator: Access Now's Digital Security Helpline, free for civil society. */
export const SPYWARE_HELP = "https://www.accessnow.org/help/";

/**
 * The stalkerware (or, for spyware, the investigations) a report's threats of one kind belong to, where every one of
 * them it lists says, and it lists them all.
 */
function threatApps(report: Report, kind: string) {
  const threats = (report.findings ?? []).filter((f) => f.severity === "threat" && f.name && f.kind === kind);
  const left = Object.entries(report.more ?? {}).some(([kind, n]) => n > 0 && threats.some((f) => f.kind === kind));
  if (left || !threats.length || !threats.every((f) => f.app)) return [];
  return [...new Set(threats.map((f) => f.app!))];
}

/**
 * Whether every site behind a "needs a check" is also on the ad list, so the reason can say so. Only where the report
 * names them all: a report that leaves some out (more than it lists) or from before `lists` says nothing.
 */
function allOnAdList(report: Report) {
  const named = (report.findings ?? []).filter((f) => f.name);
  const left = Object.values(report.more ?? {}).some((n) => n > 0);
  return !left && named.length > 0 && named.every((f) => f.severity === "check" && f.lists?.includes("ads"));
}

/**
 * A time in the report always with its day: the report is read again on later days, and saved to a file, where "02:37"
 * alone would no longer say which day. (formatTime leaves the day out for today; no day is today next to the epoch.)
 */
const withDay = (locale: ReturnType<typeof useCtx>["locale"], iso: string) => formatTime(locale, iso, new Date(0));

/** A day's cell for one site: how many of its hours it was seen in, as one of three steps. */
const hitLevel = (n: number) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3);

type Verdict = "threat" | "check" | "clean";
/** The steps under the verdict: looking through the apps, getting help with a spyware indicator, or none. */
type Next = false | "apps" | "help";

/**
 * What the report comes to, and why, in a sentence. Where the report says when each site was seen, the sentence tells a
 * one-off (most likely an ad or a redirect met while browsing) from sites seen day after day (more like an app that
 * keeps connecting). Older reports do not say when, and the sentence only gives what was found and how much.
 *
 * What the lists say about a site only adds to the sentence; it never lowers the state (toomore/anoni-net-ws#480). A
 * site on a malicious site list that an ad network is also on still needs a check: the ad list is no proof that it is
 * harmless, and an ad network has served malware before. So the state below comes from the severity of the findings
 * alone, `lists` is not read until it is settled, and stalkerware stays a known threat whatever other lists it is on.
 * The notes on sites (site-notes.ts) are not read here at all: they are drawn beside each finding once the report is
 * judged, so an ad network's note cannot turn "needs a check" into anything else.
 */
export function judge(report: Report, t: ReturnType<typeof useCtx>["t"], locale: ReturnType<typeof useCtx>["locale"]) {
  const groups = findingGroups(report);
  // decided here once, from the severities; nothing below changes it
  const state: Verdict = groups.some((g) => g.severity === "threat") ? "threat" : groups.length ? "check" : "clean";
  if (state === "clean") return { state, reason: t["inspect.report.clean"], next: false as Next };
  const n = (x: number) => formatCount(locale, x);
  const named = (report.findings ?? []).filter((f) => f.name);
  const bypass = groups.find((g) => g.kind === "bypass_dns");
  const sites = groups.filter((g) => g.kind !== "bypass_dns");
  const counted = { sites: n(sites.reduce((s, g) => s + g.sites, 0)), n: n(sites.reduce((s, g) => s + g.count, 0)) };
  // the hours the sites of one severity were seen in, on the reader's clock
  const hoursOf = (severity: "threat" | "check", kind?: string) =>
    [...new Set(named.filter((f) => f.severity === severity && (!kind || f.kind === kind)).flatMap((f) => f.hours ?? []))].sort().map(atHour);
  const lastOf = (severity: "threat" | "check", kind?: string) => Math.max(...named.filter((f) => f.severity === severity && (!kind || f.kind === kind)).map((f) => f.last ?? 0));
  const dated = (severity: "threat" | "check") => groups.filter((g) => g.severity === severity && g.kind !== "bypass_dns").every((g) => g.dated);

  if (state === "threat") {
    const threats = groups.filter((g) => g.severity === "threat");
    if (!dated("threat")) {
      return { state, reason: fmt(t["inspect.reason.threatCount"], { sites: n(threats.reduce((s, g) => s + g.sites, 0)), n: n(threats.reduce((s, g) => s + g.count, 0)) }), next: "apps" as Next };
    }
    // spyware first where there is any: it is the one to get help with, and the sentence and the steps are its own.
    // Stalkerware found beside it is listed below with the rest.
    const spy = threats.some((g) => g.kind === "spyware");
    const top = spy ? "spyware" : "stalkerware";
    const hours = hoursOf("threat", top);
    const last = lastOf("threat", top);
    // named after the stalkerware (or the investigation) where the report knows it for every site: one by its name,
    // more by how many
    const apps = threatApps(report, top);
    const base = spy ? "inspect.reason.spy" : "inspect.reason.threat";
    const words = apps.length === 1 ? `${base}App` as const : apps.length > 1 ? `${base}Apps` as const : base;
    return {
      state,
      next: (spy ? "help" : "apps") as Next,
      reason: fmt(t[words], {
        days: n(new Set(hours.map(dayOf)).size), slots: n(hours.length), app: apps[0] ?? "", apps: n(apps.length),
        last: last ? withDay(locale, new Date(last * 1000).toISOString()) : withDay(locale, hours.at(-1)!.toISOString()),
      }),
    };
  }

  const also = bypass ? fmt(t["inspect.reason.alsoBypass"], { n: n(bypass.count) }) : "";
  if (!sites.length) return { state, reason: fmt(t["inspect.reason.bypass"], { n: n(bypass!.count) }), next: false as Next };
  if (!dated("check")) return { state, reason: join(fmt(t["inspect.reason.count"], counted), also), next: false as Next };
  const hours = hoursOf("check");
  const days = [...new Set(hours.map(dayOf))];
  // seen day after day: the same steps as for a known threat, starting from the apps
  if (days.length > 1) return { state, reason: join(fmt(t["inspect.reason.repeat"], { days: n(days.length), slots: n(hours.length) }), also), next: "apps" as Next };
  const date = short(days[0]);
  // seen on one day only, and every one of them on the ad list too: one more sentence, the same state
  const ads = allOnAdList(report) ? t[sites.reduce((s, g) => s + g.sites, 0) === 1 ? "inspect.reason.alsoAdsOne" : "inspect.reason.alsoAds"] : "";
  if (hours.length > 3) return { state, reason: join(join(fmt(t["inspect.reason.oneDay"], { date, slots: n(hours.length) }), ads), also), next: false as Next };
  const clock = hours.map((h) => h.getHours());
  const periods = [...new Set(clock.map(period))];
  const when = periods.length === 1
    ? fmt(t["inspect.when.period"], { date, period: t[`inspect.period.${periods[0]}`] })
    : fmt(t["inspect.when.range"], { date, from: `${pad(Math.min(...clock))}:00`, to: `${pad(Math.max(...clock) + 1)}:00` });
  const lastHit = hours.at(-1)!.getTime();
  const after = (report.hours ?? []).filter((h) => atHour(h.hour).getTime() > lastHit && h.up + h.down > 0).length;
  const once = fmt(t[after >= QUIET_HOURS ? "inspect.reason.onceQuiet" : "inspect.reason.onceLatest"], { when });
  return { state, reason: join(join(once, ads), also), next: false as Next };
}

const period = (hour: number) => (hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening");
// sentences end in their own full stop, so they are only put side by side (a space between them in English)
const join = (a: string, b: string) => (b ? `${a}${/[.!?]$/.test(a) ? " " : ""}${b}` : a);

/** `limits`: what a report cannot tell, at its end; results so far say it beside the key instead. */
function ReportView({ report, locale, span, limits = true }: { report: Report; locale: ReturnType<typeof useCtx>["locale"]; span: Span; limits?: boolean }) {
  const { t, href } = useCtx();
  const [picked, setPicked] = useState("");
  const { cells, level } = hourGrid(report.hours ?? []);
  const groups = findingGroups(report);
  const { state, reason, next } = judge(report, t, locale);
  const week = inspectionDays(report, span);
  const kind = (id: string) => t[`inspect.kind.${id}` as keyof typeof t] ?? id;
  const why = (id: string) => t[`inspect.why.${id}` as keyof typeof t] as string | undefined;
  const percent = (n: number) => `${Math.round(n * 100)}%`;
  const dayLabel = (day: string) => short(day);
  // how serious, in words as well as in the colour of the badge (WCAG 1.4.1)
  const severity = (s: "threat" | "check") => (
    <span class={`badge badge--icon inspect-badge--${s}`} data-testid="inspect-severity">
      <Icon name={s === "threat" ? "cancel" : "warning"} />
      {t[s === "threat" ? "inspect.report.markThreat" : "inspect.report.markCheck"]}
    </span>
  );
  const dot = <span aria-hidden="true"> · </span>;
  // a name from outside: a text node, never markup
  const appWords = (f: NonNullable<Report["findings"]>[number]) => fmt(t[f.kind === "spyware" ? "inspect.app.spyware" : "inspect.app"], { app: f.app! });
  const line = (f: NonNullable<Report["findings"]>[number]) => (
    <li class={`inspect-finding inspect-finding--${f.severity}`} data-testid="inspect-finding">
      <code>{f.name}</code>
      <span class="muted small">
        {fmt(t["inspect.seen"], { n: formatCount(locale, f.count) })}
        {f.first ? ` ${fmt(t["inspect.firstSeen"], { time: withDay(locale, new Date(f.first * 1000).toISOString()) })}` : ""}
      </span>
      {f.app && <span class="small" data-testid="inspect-hit-app">{appWords(f)}</span>}
      {alsoOn(f, t) && <span class="small" data-testid="inspect-hit-lists">{alsoOn(f, t)}</span>}
      {blockedWords(f, t, locale) && <span class="small" data-testid="inspect-hit-blocked">{blockedWords(f, t, locale)}</span>}
      {noteFor(f.name) && <NoteLine note={noteFor(f.name)!} t={t} class="small" />}
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
    return { words, last: w.last ? fmt(t["inspect.hits.last"], { time: withDay(locale, w.last.toISOString()) }) : "", w };
  };
  const hitCells = (perDay: Map<string, number>) => week.days.map((day) => {
    const n = perDay.get(day) ?? 0;
    const off = week.future(day) || !week.connected.get(day);
    return <span class={`hit hit--${n ? hitLevel(n) : off ? "off" : 0}`} />;
  });
  // the days over each kind's rows
  const daysHead = () => (
    <div class="hit-row hit-row--head" aria-hidden="true">
      <span class="hit-row__cells hits__grid">{week.days.map((day) => <span class="hits__day">{dayTag(day)}</span>)}</span>
    </div>
  );
  const seenWords = (f: NonNullable<Report["findings"]>[number]) => {
    const { words, last } = seenText(f);
    return <>{words}{last && <>{dot}<span class="muted">{last}</span></>}</>;
  };
  // the lookups around Vessel, in reports that say in which hours: drawn by day like a site, with no name
  const bypassHit = (report.findings ?? []).find((f) => f.kind === "bypass_dns" && f.hours?.length);
  const hitRow = (f: NonNullable<Report["findings"]>[number]) => {
    const { w } = seenText(f);
    const lists = alsoOn(f, t);
    const blocked = blockedWords(f, t, locale);
    const note = noteFor(f.name);
    return (
      <li class="hit-row" data-testid="inspect-hit">
        <code class="hit-row__name">{f.name}</code>
        <span class="hit-row__cells hits__grid" aria-hidden="true">{hitCells(w.perDay)}</span>
        <span class="hit-row__words">
          <span data-testid="inspect-hit-words">{seenWords(f)}</span>
          {/* a name from outside: a text node, never markup */}
          {f.app && <span class="hit-row__lists" data-testid="inspect-hit-app">{appWords(f)}</span>}
          {lists && <span class="hit-row__lists" data-testid="inspect-hit-lists">{lists}</span>}
          {blocked && <span class="hit-row__lists" data-testid="inspect-hit-blocked">{blocked}</span>}
          {/* what the site is, from the notes bundled with the page: matched here, in the browser */}
          {note && <NoteLine note={note} t={t} class="hit-row__lists" />}
        </span>
      </li>
    );
  };
  const datedGroups = groups.filter((g) => g.dated);
  const noted = groups.some((g) => g.listed.some((f) => noteFor(f.name)));
  // the hours a day a row, on the same days as the bars at the top: a day without a connection keeps its row, and the
  // days still to come are left out
  const hourDays = week.days.filter((d) => !week.future(d));
  const coverage = report.coverage ?? { active_hours: 0, total_hours: 0 };
  // the counts a report has of connections without encryption and on an old TLS; older reports have neither
  const infos = ([{ id: "plain", test: "inspect-plain", n: report.plain }, { id: "oldTls", test: "inspect-old-tls", n: report.old_tls }] as const)
    .flatMap(({ id, test, n }) => (n === undefined ? [] : [{ id, test, n }]));
  // against the last moment the report has data for: the report itself does not say when it was made
  const listsOld = !!report.lists_at && (report.last ?? 0) - report.lists_at > LISTS_OLD_SECONDS;

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
              {next === "help" ? (
                <ol class="inspect-list" data-testid="inspect-next-help">
                  <li>{t["inspect.report.next.keep"]}</li>
                  <li>{t["inspect.report.next.help"]}<a href={SPYWARE_HELP} target="_blank" rel="noopener">{t["inspect.report.next.helpName"]}</a>{t["inspect.report.next.helpAfter"]}</li>
                  <li>{t["inspect.report.next.other"]}</li>
                </ol>
              ) : (
                <ol class="inspect-list">
                  {(["apps", "admin", "ask"] as const).map((k) => <li>{t[`inspect.report.next.${k}`]}</li>)}
                </ol>
              )}
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
          <ul class="plain inspect-summary" data-testid="inspect-summary">
            {groups.map((g) => (
              <li class={`inspect-kind inspect-kind--${g.severity}`} data-testid="inspect-kind">
                <div class="inspect-kind__head">
                  <h3 class="inspect-kind__name">{kind(g.kind)}</h3>
                  {severity(g.severity)}
                  <span class="muted inspect-kind__count">
                    {g.sites
                      ? fmt(t["inspect.report.sites"], { sites: formatCount(locale, g.sites), n: formatCount(locale, g.count) })
                      : fmt(t["inspect.seen"], { n: formatCount(locale, g.count) })}
                  </span>
                </div>
                {why(g.kind) && <p class="inspect-kind__why" data-testid="inspect-why">{why(g.kind)}</p>}
                {g.kind === "bypass_dns" && bypassHit ? (
                  // no site to name: the one row says on which days and in how many hours, as a site's would
                  <div class="hits" data-testid="inspect-bypass-hits">
                    {daysHead()}
                    <ul class="plain hits__rows">
                      <li class="hit-row" data-testid="inspect-bypass-row">
                        <span class="hit-row__name muted">{t["inspect.hits.noName"]}</span>
                        <span class="hit-row__cells hits__grid" aria-hidden="true">{hitCells(seenWhen(bypassHit).perDay)}</span>
                        <span class="hit-row__words" data-testid="inspect-hit-words">{seenWords(bypassHit)}</span>
                      </li>
                    </ul>
                  </div>
                ) : g.dated ? (
                  <div class="hits" data-testid="inspect-hits">
                    {daysHead()}
                    <ul class="plain hits__rows">{g.listed.slice(0, TOP_ROWS).map(hitRow)}</ul>
                    {g.listed.length > TOP_ROWS && (
                      <details class="hits__more" data-testid="inspect-hits-more">
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
                {/* the categories of this kind's notes, each said once */}
                <NoteCategories notes={g.listed.map((f) => noteFor(f.name)).filter((n): n is SiteNote => !!n)} order={NOTE_CATEGORIES} t={t} />
                {g.kind === "spyware" && (
                  <p class="muted small" data-testid="inspect-spyware-source">
                    {t["inspect.spyware.source"]}<a href={SPYWARE_SOURCE} target="_blank" rel="noopener">{t["inspect.spyware.sourceName"]}</a>{t["inspect.spyware.end"]}
                  </p>
                )}
                {g.kind !== "spyware" && g.listed.some((f) => f.app) && (
                  <p class="muted small" data-testid="inspect-app-source">
                    {t["inspect.apps.source"]}<a href={APPS_SOURCE} target="_blank" rel="noopener">{t["inspect.apps.sourceName"]}</a>
                    {t["inspect.apps.license"]}<a href={APPS_LICENSE} target="_blank" rel="noopener">CC BY 4.0</a>{t["inspect.apps.end"]}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {/* what blocked means, once, where a site went through: some of its visits Vessel did not block */}
          {(report.findings ?? []).some((f) => f.name && f.blocked !== undefined && f.blocked < f.count) && (
            <p class="muted small" data-testid="inspect-blocked-why">{t["inspect.blocked.why"]}</p>
          )}
          {noted && (
            <p class="muted small" data-testid="inspect-notes-by">
              {t["inspect.notes.by"]}<a href={href("/dns/lists/#site-notes")}>{t["inspect.notes.byLink"]}</a>{t["inspect.notes.byAfter"]}
            </p>
          )}
          {(datedGroups.length > 0 || bypassHit) && (
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
                  <thead><tr><th>{t["inspect.hits.tableSite"]}</th><th class="inspect-table__when">{t["inspect.hits.tableWhen"]}</th><th class="inspect-table__when">{t["inspect.hits.tableLast"]}</th></tr></thead>
                  <tbody>{[...datedGroups, ...(bypassHit ? [{ kind: "bypass_dns", listed: [bypassHit] }] : [])].flatMap((g) => [
                    <tr><th colSpan={3} scope="colgroup">{kind(g.kind)}</th></tr>,
                    ...g.listed.flatMap((f) => {
                      const w = seenWhen(f);
                      const row = (
                        <tr><td class="inspect-table__site">{f.name ? <code>{f.name}</code> : <span class="muted">{t["inspect.hits.noName"]}</span>}</td>
                          {/* a day to a line, each kept whole, so the site's name is what wraps on a phone */}
                          <td class="inspect-table__when">{[...w.perDay].map(([day, n]) => <span>{`${dayLabel(day)} (${n})`}</span>)}</td>
                          <td class="inspect-table__when">{w.last && <span>{withDay(locale, w.last.toISOString())}</span>}</td></tr>
                      );
                      const note = noteFor(f.name);
                      // what the site is, its short line on a row of its own the width of the table, so a phone does not squeeze it
                      return note ? [row, <tr class="inspect-table__noterow"><td colSpan={3}><NoteLine note={note} t={t} class="inspect-table__note" /></td></tr>] : [row];
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
            const sev = !found ? "ok" : THREAT_KINDS.includes(c.id) ? "threat" : "check";
            const words = t[`inspect.check.${found ? "hit" : "ok"}.${c.id}` as keyof typeof t] ?? `${kind(c.id)}: ${found ? fmt(t["inspect.seen"], { n: c.count }) : t["inspect.report.notFound"]}`;
            return (
              <li class={`inspect-check inspect-check--${sev}`} data-testid="inspect-check" data-state={sev}>
                <Icon name={sev === "ok" ? "ok" : sev === "threat" ? "cancel" : "warning"} />
                <span>{words}</span>
              </li>
            );
          })}
        </ul>
        {/* about privacy and upkeep, not signs of an intrusion: beside the checks, and they do not change what the report comes to */}
        {infos.map(({ id, test, n }) => (
          <div class="stack" data-testid={test} data-state={n ? "check" : "ok"}>
            <p class={`inspect-check inspect-check--${n ? "check" : "ok"}`}>
              <Icon name={n ? "error" : "ok"} />
              <span>{n ? fmt(t[`inspect.${id}.some`], { n: formatCount(locale, n) }) : t[`inspect.${id}.none`]}</span>
            </p>
            {n > 0 && <p class="muted small" data-testid={`${test}-why`}>{t[`inspect.${id}.why`]}</p>}
          </div>
        ))}
        {report.lists_at && (
          <p class="muted small" data-testid="inspect-lists-at">
            {join(fmt(t["inspect.report.listsAt"], { time: withDay(locale, new Date(report.lists_at * 1000).toISOString()) }), listsOld ? t["inspect.report.listsOld"] : "")}
          </p>
        )}
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
            {infos.map(({ id, n }) => <><dt>{t[`inspect.${id}.figure`]}</dt><dd>{formatCount(locale, n)}</dd></>)}
            <dt>{t["inspect.report.idle"]}</dt>
            {/* the share of a night is only a share of the nights there were: on the first day it says when it started */}
            <dd data-testid="inspect-idle">{coverage.total_hours >= 24 ? percent(nightShare(report.hours ?? [])) : t["inspect.report.idleLater"]}</dd>
          </dl>
        </details>
      </div>
      {limits && <p class="muted small">{t["inspect.report.limits"]}</p>}
    </div>
  );
}
