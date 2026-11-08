import { useEffect, useState } from "preact/hooks";
import { ApiError, type DnsFilter, type Me, type Passkey, type UsageMonths, api, last } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatDate } from "../format.ts";
import { errorText } from "../i18n/index.ts";
import { navigate } from "../router.ts";
import { setSignedIn } from "../session.ts";
import { Months, monthsSince } from "./months.tsx";
import { Invites } from "./invites.tsx";
import { Passkeys } from "./passkeys.tsx";
import { AccountNumber } from "./redeem.tsx";
import { Busy, SkLine, Spin } from "./skeleton.tsx";
import { focusHeading } from "../focus.ts";
import { announce } from "../announce.ts";
import { passkeysSupported } from "../passkey.ts";
import { useReverify } from "./reverify.tsx";

/** Links shown on the signed-in pages. */
export function AccountNav() {
  const { t, href } = useCtx();
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const logout = async () => {
    if (leaving) return;
    setLeaving(true);
    setFailed(false);
    try {
      await api.logout();
    } catch (x) {
      // only the server can clear the session cookie; until it answers, this browser stays signed in, and the next
      // person at a shared computer would land in this account. An already ended session needs nothing more.
      if (!(x instanceof ApiError && x.code === "signed_out")) {
        setFailed(true);
        setLeaving(false);
        return;
      }
    }
    setSignedIn(false);
    navigate(href("/"));
  };
  return (
    <>
      <nav class="subnav" aria-label={t["nav.account"]}>
        <a href={href("/devices/")}>{t["nav.devices"]}</a>
        <a href={href("/account/")}>{t["nav.account"]}</a>
        <button class="link-button" type="button" onClick={logout} aria-disabled={leaving} aria-busy={leaving}>
          {leaving ? <><Spin />{t["busy.logout"]}</> : t["nav.logout"]}
        </button>
      </nav>
      {failed && <p class="error" role="alert">{t["nav.logoutFailed"]}</p>}
    </>
  );
}

/**
 * The strongest DNS filter on the devices, from the list the devices page already loaded; malware (the default)
 * when it has not. The monthly record's skeleton takes the shape this filter gives the rows.
 */
function filterGuess(): DnsFilter {
  const list = last.devices;
  if (!list) return "malware";
  return list.some((d) => d.dns_filter === "ads") ? "ads" : list.some((d) => d.dns_filter === "malware") ? "malware" : "none";
}

export function Account() {
  const { t, href, locale } = useCtx();
  const [me, setMe] = useState<Me | null>(last.me ?? null);
  // undefined while loading, null if the passkeys failed to load (the rest of the page still works)
  const [passkeys, setPasskeys] = useState<Passkey[] | null | undefined>(last.passkeys);
  // likewise for the monthly record
  const [months, setMonths] = useState<UsageMonths | null | undefined>(last.months);
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState("");
  const [deleting, setDeleting] = useState(false);
  // a number just replaced with a passkey: shown on its own, once, then back to the account page
  const [newNumber, setNewNumber] = useState("");
  // adding or removing a passkey and deleting the account may first ask the person to confirm it is them
  const { guard, dialog } = useReverify(!!passkeys?.length && passkeysSupported());

  useEffect(() => {
    api.passkeys().then(setPasskeys).catch(() => setPasskeys(null));
    api.usageMonths().then(setMonths).catch(() => setMonths(null));
    api.me().then(setMe).catch((x) => {
      if (x instanceof ApiError && x.code === "signed_out") {
        setSignedIn(false);
        navigate(href("/login/"), true);
      }
      else setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    });
  }, []);

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await guard(() => api.deleteAccount());
      // the header and the home page no longer offer "My devices", and the home page says it is done
      setSignedIn(false);
      announce(t["account.deleted"]);
      navigate(href("/"));
    } catch (x) {
      setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
      setDeleting(false);
    }
  };

  if (newNumber) return <AccountNumber number={newNumber} rotated onContinue={() => { setNewNumber(""); focusHeading(); }} />;
  if (err && !me) return <section class="wrap narrow"><p class="error" role="alert">{err}</p></section>;
  // The page keeps its final layout while loading: the words are there from the start, and only what comes
  // from the server (the dates, the monthly record, the passkeys) is grey until it arrives, then eases in.
  const loading = !me || months === undefined || passkeys === undefined;
  const day = (iso: string | null | undefined) => (iso ? formatDate(locale, iso) : "-");
  return (
    <section class="wrap narrow stack account-page" aria-busy={loading}>
      <AccountNav />
      <h1>{t["account.title"]}</h1>
      <dl class="facts">
        <dt>{t["account.created"]}</dt>
        <dd>{me ? <span class="appear">{day(me.created_on)}</span> : <SkLine w="short" />}</dd>
        <dt>{t["account.lastLogin"]}</dt>
        <dd>{me ? <span class="appear">{day(me.last_login_on)}</span> : <SkLine w="short" />}</dd>
      </dl>
      {/* on a wide screen two columns, the record and the invites beside the passkeys (styles.css, .account-cols) */}
      <div class="account-cols">
        <div class="account-col">
          <Months data={months} rows={monthsSince(me?.created_on)} guess={filterGuess()} />
          <Invites />
        </div>
        <div class="account-col">
          <Passkeys initial={passkeys} guard={guard} onNewNumber={(n) => { setNewNumber(n); window.scrollTo(0, 0); }} />
        </div>
      </div>
      <div class="account-section account-delete">
        <div class="card card--warn card--flat stack">
          <h2>{t["account.deleteTitle"]}</h2>
          <p>{t["account.deleteBody"]}</p>
          <label class="check">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.currentTarget.checked)} />
            {t["account.deleteCheck"]}
          </label>
          {err && <p class="error" role="alert">{err}</p>}
          <button class="nb-button nb-button--danger" type="button" disabled={!sure} aria-disabled={deleting} aria-busy={deleting} onClick={remove}>
            {deleting ? <><Spin />{t["busy.delete"]}</> : t["account.deleteSubmit"]}
          </button>
        </div>
      </div>
      {loading && <Busy />}
      {dialog}
    </section>
  );
}
