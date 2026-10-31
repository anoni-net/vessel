import { useEffect, useState } from "preact/hooks";
import { ApiError, type Passkey, api } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatDate } from "../format.ts";
import { errorText, fmt } from "../i18n/index.ts";
import { createPasskey, passkeyErrorCode, passkeysSupported, usePasskey } from "../passkey.ts";
import { SkButton, SkField, SkLine, Spin } from "./skeleton.tsx";

const LIMIT = 5;

/** A short message for what went wrong: the browser's own errors first, then the backend's codes. */
function useErrorText() {
  const { t } = useCtx();
  return (x: unknown) => errorText(t, passkeyErrorCode(x) ?? (x instanceof ApiError ? x.code : "unknown"));
}

/** Right after an account is made: offer a passkey so the 16 digits never have to be typed again. Skipping is fine. */
export function PasskeyOffer({ onDone }: { onDone: () => void }) {
  const { t } = useCtx();
  const message = useErrorText();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const add = async () => {
    setBusy(true);
    setErr("");
    try {
      await api.addPasskey(await createPasskey(await api.passkeyOptions()), "");
      onDone();
    } catch (x) {
      setErr(message(x));
      setBusy(false);
    }
  };
  return (
    <section class="wrap narrow stack" data-testid="passkey-offer">
      <h1>{t["passkey.offer.title"]}</h1>
      <p>{t["passkey.offer.body"]}</p>
      <p class="muted small">{t["passkey.what"]}</p>
      {err && <p class="error" role="alert">{err}</p>}
      <button class="nb-button nb-button--primary" type="button" onClick={add} disabled={busy} aria-busy={busy}>
        {busy ? <><Spin />{t["busy.passkey"]}</> : t["passkey.add"]}
      </button>
      <button class="link-button" type="button" onClick={onDone} disabled={busy}>{t["passkey.offer.skip"]}</button>
    </section>
  );
}

/**
 * The account page's passkeys: the list, adding one, removing one, and replacing the account number with one.
 * The new number goes to `onNewNumber`, so the page can show it on its own, once.
 */
export function Passkeys({ initial, onNewNumber }: { initial: Passkey[] | null | undefined; onNewNumber: (number: string) => void }) {
  const { t, locale } = useCtx();
  const message = useErrorText();
  // the account page loads the list: undefined while it does, null if it failed
  const [list, setList] = useState<Passkey[] | null | undefined>(initial);
  useEffect(() => {
    setList(initial);
    if (initial === null) setErr(t["errors.unknown"]);
  }, [initial]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<"add" | "rotate" | number | null>(null);
  const [err, setErr] = useState("");
  // known only in the browser; the prerendered page assumes passkeys work, so nothing flashes for most people
  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(passkeysSupported()), []);

  const run = async (what: "add" | "rotate" | number, task: () => Promise<void>) => {
    setBusy(what);
    setErr("");
    try {
      await task();
    } catch (x) {
      setErr(message(x));
    } finally {
      setBusy(null);
    }
  };
  const add = () => run("add", async () => {
    setList(await api.addPasskey(await createPasskey(await api.passkeyOptions()), label.trim()));
    setLabel("");
  });
  const remove = (p: Passkey) => {
    if (!window.confirm(fmt(t["passkey.confirmDelete"], { name: p.label || t["passkey.unnamed"] }))) return;
    void run(p.id, async () => setList(await api.deletePasskey(p.id)));
  };
  const rotate = () => {
    if (!window.confirm(t["passkey.rotate.confirm"])) return;
    void run("rotate", async () => onNewNumber((await api.rotateNumber(await usePasskey(await api.rotateOptions()))).account_number));
  };

  return (
    <div class="stack" data-testid="passkeys">
      <h2>{t["passkey.title"]}</h2>
      <p>{t["passkey.body"]}</p>
      {!supported && <p class="card card--warn card--flat small">{t["passkey.unsupported"]}</p>}
      {list === undefined && (
        // the name field and the button, until the list arrives
        <div class="stack-sm passkey-skeleton" aria-hidden="true">
          <SkLine w="short" />
          <SkField />
          <SkButton />
        </div>
      )}
      {list && list.length > 0 && (
        <ul class="stack plain passkey-list appear">
          {list.map((p) => (
            <li class="card card--flat passkey-item" aria-busy={busy === p.id}>
              <span>
                <span class="strong">{p.label || t["passkey.unnamed"]}</span>
                <span class="muted small block">{fmt(t["passkey.added"], { date: formatDate(locale, p.created_on) })}</span>
              </span>
              {busy === p.id
                ? <span class="muted strong" role="status"><Spin />{t["busy.delete"]}</span>
                : <button class="link-button" type="button" onClick={() => remove(p)} disabled={busy !== null}>{t["devices.delete"]}</button>}
            </li>
          ))}
        </ul>
      )}
      {list && list.length > 0 && <p class="muted small">{t["passkey.deleteNote"]}</p>}
      {supported && list && list.length < LIMIT && (
        <div class="stack-sm">
          <label for="passkey-label" class="strong">{t["passkey.label"]} <span class="muted small">{t["feedback.optional"]}</span></label>
          <input id="passkey-label" class="nb-input" maxLength={40} autoComplete="off" placeholder={t["passkey.labelPh"]}
            value={label} onInput={(e) => setLabel(e.currentTarget.value)} />
          <button class="nb-button nb-button--ink" type="button" onClick={add} disabled={busy !== null} aria-busy={busy === "add"}>
            {busy === "add" ? <><Spin />{t["busy.passkey"]}</> : t["passkey.add"]}
          </button>
        </div>
      )}
      {list && list.length >= LIMIT && <p class="muted small">{fmt(t["passkey.full"], { max: LIMIT })}</p>}
      {err && <p class="error" role="alert">{err}</p>}

      {supported && list && list.length > 0 && (
        <div class="card card--flat stack" data-testid="rotate">
          <h3>{t["passkey.rotate.title"]}</h3>
          <p>{t["passkey.rotate.body"]}</p>
          <button class="nb-button" type="button" onClick={rotate} disabled={busy !== null} aria-busy={busy === "rotate"}>
            {busy === "rotate" ? <><Spin />{t["busy.passkey"]}</> : t["passkey.rotate.submit"]}
          </button>
        </div>
      )}
    </div>
  );
}
