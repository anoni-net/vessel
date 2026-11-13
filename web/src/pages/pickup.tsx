import { useEffect, useState } from "preact/hooks";
import { ApiError, type PickupInfo, type PickupState, api } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatDate } from "../format.ts";
import { errorText } from "../i18n/index.ts";
import { fmt } from "../i18n/fmt.ts";
import { INVITE, group, groupedLength, regroup } from "../grouped.ts";
import { focusHeading } from "../focus.ts";
import { announce } from "../announce.ts";
import { Spin } from "./skeleton.tsx";

// Asking for an invite without giving any way to be reached (toomore/anoni-net-ws#441). The request gets a pickup
// number shown once; a maintainer approves or declines it on the host; the person comes back here with the number and,
// once approved, redeems it on /redeem/, where the number is the invite. The page is linked from the newsletter only
// for now, and marked noindex (seo.ts).

// this browser remembers the number, so coming back needs nothing typed; storage can be missing or throw
const KEY = "vessel-pickup";

function remembered(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function remember(number: string) {
  try {
    if (number) localStorage.setItem(KEY, number);
    else localStorage.removeItem(KEY);
  } catch {
    // no storage: the person has the number they saved
  }
}

export function Pickup() {
  const { t, href } = useCtx();
  const [info, setInfo] = useState<PickupInfo | null>(null);
  const [failed, setFailed] = useState(false);
  // the number just given, shown once until the person says it is saved
  const [fresh, setFresh] = useState("");
  const [number, setNumber] = useState("");

  useEffect(() => {
    setNumber(remembered());
    api.pickupInfo().then(setInfo, () => setFailed(true));
  }, []);

  if (fresh) {
    return <Fresh number={fresh} days={info?.wait_days} onDone={() => { remember(fresh); setNumber(fresh); setFresh(""); }} />;
  }

  return (
    <section class="wrap narrow stack">
      <h1>{t["pickup.title"]}</h1>
      <p class="feedback-lead">{t["pickup.lead"]}</p>
      <p class="small"><a href={href("/for-groups/")}>{t["forGroups.link"]}</a></p>
      {number ? (
        <Status number={number} onForget={() => { remember(""); setNumber(""); }} />
      ) : (
        <>
          {failed && <p class="error" role="alert">{errorText(t, "network")}</p>}
          {info && !info.open && <p class="card card--tint card--flat" data-testid="pickup-closed">{t["pickup.closed"]}</p>}
          {info?.open && <Ask info={info} onAsked={setFresh} />}
          {/* folded under the form, the way most people come; open when there is no form */}
          {info && <Lookup open={!info.open} onFound={(n) => { remember(n); setNumber(n); }} />}
        </>
      )}
    </section>
  );
}

function Ask({ info, onAsked }: { info: PickupInfo; onAsked: (number: string) => void }) {
  const { t } = useCtx();
  const [purpose, setPurpose] = useState("");
  const [network, setNetwork] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: Event) => {
    e.preventDefault();
    setTried(true);
    if (busy || !purpose || !network) return;
    setBusy(true);
    setErr("");
    try {
      const asked = await api.askPickup(purpose, network, note.trim());
      onAsked(asked.number);
    } catch (x) {
      setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    } finally {
      setBusy(false);
    }
  };

  const pick = (name: "purpose" | "network", options: string[], value: string, set: (v: string) => void) => (
    <fieldset class="stack-sm" aria-describedby={tried && !value ? `pickup-${name}-error` : undefined}>
      <legend class="strong">{t[`pickup.${name}`]}</legend>
      {options.map((o) => (
        <label class={`choice choice--radio${o === value ? " choice--on" : ""}`}>
          <input type="radio" name={name} value={o} checked={o === value} onChange={() => set(o)} />
          <span>{t[`pickup.${name}.${o}` as keyof typeof t] ?? o}</span>
        </label>
      ))}
      {tried && !value && <p class="error" role="alert" id={`pickup-${name}-error`}>{t["pickup.needChoice"]}</p>}
    </fieldset>
  );

  return (
    <form class="stack" onSubmit={submit} noValidate data-testid="pickup-form">
      {pick("purpose", info.purposes, purpose, setPurpose)}
      {pick("network", info.networks, network, setNetwork)}
      <label for="pickup-note" class="strong">{t["pickup.note"]} <span class="muted small">{t["feedback.optional"]}</span></label>
      <textarea id="pickup-note" class="nb-input nb-textarea" rows={3} maxLength={info.note_max} value={note}
        aria-describedby="pickup-note-hint" onInput={(e) => setNote(e.currentTarget.value)} />
      <p id="pickup-note-hint" class="muted small">{fmt(t["pickup.noteHint"], { n: info.note_max })}</p>
      {err && <p class="error" role="alert">{err}</p>}
      <button class="nb-button nb-button--primary" type="submit" aria-disabled={busy} aria-busy={busy}>
        {busy ? <><Spin />{t["busy.pickup"]}</> : t["pickup.submit"]}
      </button>
    </form>
  );
}

/** The number, shown once: the person saves it before going on. Nobody is told when a request is decided, since
 * there is no way to reach them, so the page says to come back, and by when. */
function Fresh({ number, days, onDone }: { number: string; days?: number; onDone: () => void }) {
  const { t } = useCtx();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  // shown in place of the form
  useEffect(() => focusHeading(), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
      announce(t["number.copied"]);
    } catch {
      /* clipboard can be blocked; the number is still on screen */
    }
  };
  return (
    <section class="wrap narrow stack">
      <h1>{t["pickup.number.title"]}</h1>
      <p class="muted">{t["pickup.number.lead"]}</p>
      <p class="card card--warn card--flat" data-testid="pickup-no-notice">
        {t["pickup.noNotice"]}{days ? fmt(t["pickup.keptDays"], { days }) : ""}
      </p>
      <div class="number-box printable">
        <p class="small strong">{t["pickup.number.label"]}</p>
        <p class="mono number" data-testid="pickup-number">{number}</p>
      </div>
      <div class="cards cards--3 tools">
        <button class="nb-button" type="button" onClick={copy}>{copied ? t["number.copied"] : t["number.copy"]}</button>
        <button class="nb-button" type="button" onClick={() => window.print()}>{t["number.print"]}</button>
      </div>
      <label class="check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.currentTarget.checked)} />
        {t["pickup.number.saved"]}
      </label>
      <button class="nb-button nb-button--ink" type="button" disabled={!saved} onClick={onDone}>
        {saved ? t["number.continue"] : t["number.locked"]}
      </button>
    </section>
  );
}

/** Where a request stands, for the number this browser remembers. */
function Status({ number, onForget }: { number: string; onForget: () => void }) {
  const { t, href, locale } = useCtx();
  const [state, setState] = useState<{ state: PickupState; until: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const check = async () => {
    setBusy(true);
    setErr("");
    try {
      const answer = await api.pickupStatus(number);
      setState(answer);
      // used: an account was made with it, and there is nothing left to come back for
      if (answer.state === "used") remember("");
    } catch (x) {
      setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => void check(), [number]);

  return (
    <div class="stack" data-testid="pickup-status">
      <div class="number-box">
        <p class="small strong">{t["pickup.number.label"]}</p>
        <p class="mono number">{number}</p>
      </div>
      {err && <p class="error" role="alert">{err}</p>}
      {state && (
        <p class={`card card--flat${state.state === "approved" ? " card--tint" : ""}`} role="status" data-testid={`pickup-${state.state}`}>
          {state.state === "approved" && state.until
            ? fmt(t["pickup.state.approved"], { date: formatDate(locale, state.until) })
            : state.state === "waiting" && state.until
              ? fmt(t["pickup.state.waitingUntil"], { date: formatDate(locale, state.until) })
              : t[`pickup.state.${state.state}`]}
        </p>
      )}
      {state?.state === "approved" && (
        // the number goes after the #, so it never reaches the server in the address; /redeem/ takes it from there
        <a class="nb-button nb-button--primary" href={`${href("/redeem/")}#${encodeURIComponent(number)}`}>{t["pickup.redeem"]}</a>
      )}
      {state?.state === "used" && <a class="nb-button" href={href("/login/")}>{t["login.title"]}</a>}
      {state?.state !== "used" && state?.state !== "approved" && (
        <button class="nb-button" type="button" onClick={check} aria-disabled={busy} aria-busy={busy}>
          {busy ? <><Spin />{t["pickup.refresh"]}</> : t["pickup.refresh"]}
        </button>
      )}
      <button class="link-button small pickup-forget" type="button" onClick={onForget}>{t["pickup.forget"]}</button>
    </div>
  );
}

/** A number saved earlier, typed in on another browser or after the storage was cleared. */
function Lookup({ open, onFound }: { open: boolean; onFound: (number: string) => void }) {
  const { t } = useCtx();
  const [value, setValue] = useState("");
  const done = group(value, INVITE).length === groupedLength(INVITE);
  return (
    <details class="faq__item pickup-lookup" open={open}>
      <summary>{t["pickup.check.title"]}</summary>
      <form class="stack" onSubmit={(e) => { e.preventDefault(); if (done) onFound(group(value, INVITE)); }}>
        <label for="pickup-lookup" class="strong">{t["pickup.number.label"]}</label>
        <input id="pickup-lookup" class="nb-input nb-input--code mono" autoComplete="off" autoCapitalize="characters"
          spellcheck={false} value={value} maxLength={groupedLength(INVITE)} placeholder="XXXX-XXXX-XXXX-XXXX"
          onInput={(e) => setValue(regroup(e.currentTarget, INVITE))} />
        <button class="nb-button" type="submit" aria-disabled={!done}>{t["pickup.check.submit"]}</button>
      </form>
    </details>
  );
}
