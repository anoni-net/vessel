import { useEffect, useState } from "preact/hooks";
import { ApiError, api } from "../api.ts";
import { resultOf, track } from "../analytics.ts";
import { useCtx } from "../context.ts";
import { Icon } from "../icons.tsx";
import { Spin } from "./skeleton.tsx";
import { errorText } from "../i18n/index.ts";
import { ACCOUNT, PM_USERNAME, groupedLength, regroup } from "../grouped.ts";
import { passkeyErrorCode, passkeysSupported, usePasskey } from "../passkey.ts";
import { navigate } from "../router.ts";
import { setSignedIn, useSignedIn } from "../session.ts";

export function Login() {
  const { t, href } = useCtx();
  const [number, setNumber] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const signedIn = useSignedIn();

  // already signed in: nothing to type
  useEffect(() => {
    if (signedIn === true) navigate(href("/devices/"), true);
  }, [signedIn]);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.login(number);
      setSignedIn(true);
      track("login", { result: "ok", method: "number" });
      navigate(href("/devices/"));
    } catch (x) {
      track("login", { result: resultOf(x), method: "number" });
      setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    } finally {
      setBusy(false);
    }
  };

  // no number to type: the browser lists this site's passkeys, the person picks one and unlocks it
  const [withKey, setWithKey] = useState(false);
  const [keyErr, setKeyErr] = useState("");
  const [canKey, setCanKey] = useState(false);
  useEffect(() => setCanKey(passkeysSupported()), []);
  const passkey = async () => {
    setWithKey(true);
    setKeyErr("");
    try {
      await api.passkeyLogin(await usePasskey(await api.passkeyLoginOptions()));
      setSignedIn(true);
      track("login", { result: "ok", method: "passkey" });
      navigate(href("/devices/"));
    } catch (x) {
      const code = passkeyErrorCode(x) ?? (x instanceof ApiError ? x.code : "unknown");
      track("login", { result: resultOf(x), method: "passkey" });
      setKeyErr(errorText(t, code));
    } finally {
      setWithKey(false);
    }
  };

  return (
    <section class="wrap narrow">
      <h1>{t["login.title"]}</h1>
      {canKey && (
        <div class="stack passkey-login" data-testid="passkey-login">
          <button class="nb-button" type="button" onClick={passkey} disabled={withKey} aria-busy={withKey}>
            {withKey ? <><Spin />{t["busy.passkey"]}</> : <><Icon name="passkey" />{t["passkey.login"]}</>}
          </button>
          {keyErr && <p class="error" role="alert">{keyErr}</p>}
          <p class="muted small center">{t["passkey.or"]}</p>
        </div>
      )}
      <form class="stack" onSubmit={submit}>
        {/* a password field with a fixed user name, so password managers offer to save the number and fill it in */}
        <input class="sr-only" type="text" name="username" autoComplete="username" value={PM_USERNAME} readOnly
          tabIndex={-1} aria-hidden="true" />
        <div class="row">
          <label for="number" class="strong">{t["login.label"]}</label>
          <button class="link-button small" type="button" aria-controls="number" aria-pressed={shown}
            onClick={() => setShown(!shown)}>{shown ? t["login.hide"] : t["login.show"]}</button>
        </div>
        {/* Show turns it into a text field; Preact types the two separately, hence the cast */}
        <input id="number" class="nb-input nb-input--code mono" type={(shown ? "text" : "password") as "text"}
          name="password" inputMode="numeric" autoComplete="current-password" required spellcheck={false}
          value={number} maxLength={groupedLength(ACCOUNT)} placeholder="0000 0000 0000 0000"
          onInput={(e) => setNumber(regroup(e.currentTarget, ACCOUNT))} aria-describedby="number-hint" />
        <p id="number-hint" class="muted small">{t["login.hint"]}</p>
        {err && <p class="error" role="alert">{err}</p>}
        <button class="nb-button nb-button--primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy ? <><Spin />{t["busy.login"]}</> : t["login.submit"]}
        </button>
      </form>
      <p class="small">
        {t["login.noAccount"]} <a href={href("/redeem/")}>{t["login.redeem"]}</a>
      </p>
    </section>
  );
}
