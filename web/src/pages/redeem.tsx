import { useState } from "preact/hooks";
import { ApiError, api } from "../api.ts";
import { resultOf, track } from "../analytics.ts";
import { useCtx } from "../context.ts";
import { Spin } from "./skeleton.tsx";
import { errorText } from "../i18n/index.ts";
import { INVITE, PM_USERNAME, groupedLength, regroup } from "../grouped.ts";
import { navigate } from "../router.ts";
import { setSignedIn, useSignedIn } from "../session.ts";

export function Redeem() {
  const { t, href } = useCtx();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [number, setNumber] = useState("");
  const signedIn = useSignedIn();

  if (number) return <AccountNumber number={number} />;

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      setNumber((await api.redeem(code)).account_number);
      setSignedIn(true);
      track("redeem", { result: "ok" });
    } catch (x) {
      track("redeem", { result: resultOf(x) });
      setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="wrap narrow">
      <h1>{t["redeem.title"]}</h1>
      {signedIn === true && (
        <p class="card card--warn card--flat small">
          {t["redeem.signedIn"]} <a class="strong" href={href("/devices/")}>{t["home.devices"]}</a>
        </p>
      )}
      <form class="stack" onSubmit={submit}>
        <label for="code" class="strong">{t["redeem.label"]}</label>
        <input id="code" class="nb-input nb-input--code mono" autoComplete="off" autoCapitalize="characters" spellcheck={false}
          required value={code} maxLength={groupedLength(INVITE)} placeholder="XXXX-XXXX-XXXX-XXXX"
          onInput={(e) => setCode(regroup(e.currentTarget, INVITE))} aria-describedby="code-hint" />
        <p id="code-hint" class="muted small">{t["redeem.hint"]}</p>
        {err && <p class="error" role="alert">{err}</p>}
        <p class="small">
          {t["redeem.read.before"]}<a href={href("/terms/")}>{t["terms.title"]}</a>{t["redeem.read.and"]}
          <a href={href("/privacy/")}>{t["privacy.title"]}</a>{t["redeem.read.after"]}
        </p>
        <button class="nb-button nb-button--primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy ? <><Spin />{t["busy.redeem"]}</> : t["redeem.submit"]}
        </button>
      </form>
    </section>
  );
}

/**
 * Chromium browsers show their "save password?" prompt for this, and it stays up while the next page loads;
 * elsewhere it does nothing and the number is saved the first time someone signs in with it.
 */
async function offerToSave(number: string): Promise<void> {
  const Credential = (window as { PasswordCredential?: new (data: { id: string; password: string; name?: string }) => Credential }).PasswordCredential;
  if (!Credential) return;
  try {
    await navigator.credentials.store(new Credential({ id: PM_USERNAME, password: number, name: PM_USERNAME }));
  } catch {
    /* declined or unavailable; the number is already saved some other way */
  }
}

function AccountNumber({ number }: { number: string }) {
  const { t, href } = useCtx();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
    } catch {
      /* clipboard can be blocked; the number is still on screen */
    }
  };
  const download = () => {
    // the BOM and charset let Notepad and phone text viewers read the label as UTF-8 instead of Big5 or similar
    const text = `\ufeff${t["number.file"]}\r\n${number}\r\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "vessel-account.txt" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section class="wrap narrow stack">
      <h1>{t["number.title"]}</h1>
      <p class="muted">{t["number.lead"]}</p>
      <div class="number-box printable">
        <p class="small strong">{t["number.label"]}</p>
        <p class="mono number" data-testid="account-number">{number}</p>
      </div>
      <div class="cards cards--3 tools">
        <button class="nb-button" type="button" onClick={copy}>{copied ? t["number.copied"] : t["number.copy"]}</button>
        <button class="nb-button" type="button" onClick={download}>{t["number.download"]}</button>
        <button class="nb-button" type="button" onClick={() => window.print()}>{t["number.print"]}</button>
      </div>
      <div class="card card--warn card--flat">
        <p class="strong">{t["number.warnTitle"]}</p>
        <p>{t["number.warnBody"]}</p>
      </div>
      <label class="check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.currentTarget.checked)} />
        {t["number.saved"]}
      </label>
      <button class="nb-button nb-button--ink" type="button" disabled={!saved} onClick={() => { track("number-continue"); void offerToSave(number); navigate(href("/devices/")); }}>
        {saved ? t["number.continue"] : t["number.locked"]}
      </button>
    </section>
  );
}
