import { useState } from "preact/hooks";
import { ApiError, api } from "../api.ts";
import { resultOf, track } from "../analytics.ts";
import { useCtx } from "../context.ts";
import { errorText } from "../i18n/index.ts";
import { navigate } from "../router.ts";

export function Login() {
  const { t, href } = useCtx();
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.login(number);
      track("login", { result: "ok" });
      navigate(href("/devices/"));
    } catch (x) {
      track("login", { result: resultOf(x) });
      setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="wrap narrow">
      <h1>{t["login.title"]}</h1>
      <form class="stack" onSubmit={submit}>
        <label for="number">{t["login.label"]}</label>
        <input id="number" class="nb-input mono" inputMode="numeric" autoComplete="off" required
          value={number} onInput={(e) => setNumber(e.currentTarget.value)} aria-describedby="number-hint" />
        <p id="number-hint" class="muted small">{t["login.hint"]}</p>
        {err && <p class="error" role="alert">{err}</p>}
        <button class="nb-button nb-button--primary" type="submit" disabled={busy}>{t["login.submit"]}</button>
      </form>
      <p class="small">
        {t["login.noAccount"]} <a href={href("/redeem/")}>{t["login.redeem"]}</a>
      </p>
    </section>
  );
}
