import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, type Invites as State, api, last } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatDate, formatDay } from "../format.ts";
import { errorText, fmt } from "../i18n/index.ts";
import { Spin } from "./skeleton.tsx";
import { focusLater } from "../focus.ts";
import { announce } from "../announce.ts";

/**
 * The account page's invites (toomore/anoni-net-ws#458): how many more people the account can invite, making a code,
 * sharing it, and withdrawing one not yet used. A new code is shown here once, since the server keeps only its hash.
 * Nothing on this page says who used which code: the server does not know either.
 */
export function Invites() {
  const { t, href, locale } = useCtx();
  // undefined while loading, null if it failed; what the last visit saw meanwhile, so the page does not jump
  const [state, setState] = useState<State | null | undefined>(last.invites);
  const [made, setMade] = useState<{ code: string; expires_at: string } | null>(null);
  const [busy, setBusy] = useState<"make" | number | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  // no clipboard where the page is not a secure context (Onion Browser on iOS); the link is on screen to select
  const [canCopy, setCanCopy] = useState(true);
  // where focus goes when the button that had it is gone
  const heading = useRef<HTMLHeadingElement>(null);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api.invites().then((s) => setState(Array.isArray(s?.open) ? s : null)).catch(() => setState(null));
    setCanShare(typeof navigator.share === "function");
    setCanCopy(typeof navigator.clipboard?.writeText === "function");
  }, []);

  const run = async (what: "make" | number, task: () => Promise<void>) => {
    if (busy !== null) return;
    setBusy(what);
    setErr("");
    try {
      await task();
    } catch (x) {
      setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    } finally {
      setBusy(null);
    }
  };
  const make = () => run("make", async () => {
    const r = await api.makeInvite();
    setMade({ code: r.code, expires_at: r.expires_at });
    setCopied(false);
    setState(await api.invites());
    announce(t["invite.madeNote"]);
    // the new code is what comes next, and the button is gone after the last one
    focusLater(() => card.current);
  });
  const withdraw = (id: number) => {
    if (!window.confirm(t["invite.withdrawConfirm"])) return;
    void run(id, async () => {
      setState(await api.withdrawInvite(id));
      announce(t["invite.withdrawn"]);
    }).then(() => focusLater(() => heading.current, true));
  };

  // Not a part of the page anyone needs: while it loads, if it fails, and when invites are off for every account,
  // the page says nothing about them. (A failed load the first time shows nothing; the account page stays usable.)
  if (!state || state.reason === "off") return null;
  // the invites carry full times; the day the account may start inviting is a bare date
  const day = (iso: string) => formatDay(locale, iso);
  // the code after the #, which the browser does not send to the server; the redeem page reads it from there
  const link = made ? `${location.origin}${href("/redeem/")}#${made.code}` : "";
  const message = made ? fmt(t["invite.message"], { link, code: made.code, days: state.days }) : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      announce(t["invite.copied"]);
    } catch {
      /* clipboard can be blocked; the code and the link are still on screen */
    }
  };
  const share = () => void navigator.share({ text: message }).catch(() => undefined);

  return (
    <div class="stack account-section" data-testid="invites">
      <h2 ref={heading}>{t["invite.title"]}</h2>
      <p>{fmt(t["invite.body"], { days: state.days })}</p>
      <div class="stack appear">
        {state.reason === null && <p class="strong" data-testid="invites-left">{fmt(t["invite.left"], { n: state.left })}</p>}
        {/* right after making the last one, the new code says enough; "none left" waits for the next visit */}
        {state.reason && !(made && state.reason === "none_left") && (
          <p class="muted small" data-testid="invites-wait">
            {fmt(t[`invite.why.${state.reason}`], { date: formatDate(locale, state.eligible_on) })}
          </p>
        )}
        {made && (
          <div class="card card--flat stack invite-made" data-testid="invite-made" ref={card}>
            <p class="small strong">{t["invite.code"]}</p>
            <p class="mono number" data-testid="invite-code">{made.code}</p>
            <p class="small invite-link">{link}</p>
            <div class="row invite-tools">
              {canCopy && <button class="nb-button" type="button" onClick={copy}>{copied ? t["invite.copied"] : t["invite.copy"]}</button>}
              {canShare && <button class="nb-button" type="button" onClick={share}>{t["invite.share"]}</button>}
            </div>
            <p class="muted small">{fmt(t["invite.once"], { date: day(made.expires_at) })}</p>
          </div>
        )}
        {state.reason === null && (
          <button class="nb-button nb-button--ink" type="button" onClick={make} disabled={busy !== null && busy !== "make"} aria-disabled={busy === "make"} aria-busy={busy === "make"}>
            {busy === "make" ? <><Spin />{t["busy.invite"]}</> : t["invite.make"]}
          </button>
        )}
        {state.open.length > 0 && (
          <ul class="stack plain" data-testid="invites-open">
            {state.open.map((i) => (
              <li class="card card--flat passkey-item" aria-busy={busy === i.id}>
                <span>
                  <span class="strong">{t["invite.unused"]}</span>
                  <span class="muted small block">{fmt(t["invite.dates"], { made: day(i.created_at), until: day(i.expires_at) })}</span>
                </span>
                {busy === i.id
                  ? <span class="muted strong"><Spin />{t["busy.delete"]}</span>
                  : <button class="link-button" type="button" onClick={() => withdraw(i.id)} disabled={busy !== null}>{t["invite.withdraw"]}</button>}
              </li>
            ))}
          </ul>
        )}
        {state.used > 0 && <p class="muted small" data-testid="invites-used">{fmt(t["invite.used"], { n: state.used })}</p>}
      </div>
      {err && <p class="error" role="alert">{err}</p>}
    </div>
  );
}
