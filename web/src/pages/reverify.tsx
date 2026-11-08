import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, api } from "../api.ts";
import { useCtx } from "../context.ts";
import { ACCOUNT, PM_USERNAME, regroup } from "../grouped.ts";
import { errorText } from "../i18n/index.ts";
import { Icon } from "../icons.tsx";
import { passkeyErrorCode, passkeysSupported, usePasskey } from "../passkey.ts";
import { Spin } from "./skeleton.tsx";

type Pending = { resolve: () => void; reject: (x: unknown) => void };

/**
 * Adding or removing a passkey and deleting the account need a sign-in from the last few minutes; after that the
 * backend answers verify_required. `guard` runs a step, and on that answer asks the person to confirm with a passkey
 * or the account number, then runs the step again. `dialog` goes somewhere in the page; it shows only while asking.
 * Cancelling ends the step with verify_cancelled.
 */
export function useReverify(hasPasskey: boolean) {
  const [pending, setPending] = useState<Pending | null>(null);
  const guard = async <T,>(task: () => Promise<T>): Promise<T> => {
    try {
      return await task();
    } catch (x) {
      if (!(x instanceof ApiError && x.code === "verify_required")) throw x;
      await new Promise<void>((resolve, reject) => setPending({ resolve, reject }));
      return task();
    }
  };
  const dialog = pending && (
    <Reverify hasPasskey={hasPasskey}
      onDone={() => { pending.resolve(); setPending(null); }}
      onCancel={() => { pending.reject(new ApiError("verify_cancelled", 0)); setPending(null); }} />
  );
  return { guard, dialog };
}

function Reverify({ hasPasskey, onDone, onCancel }: { hasPasskey: boolean; onDone: () => void; onCancel: () => void }) {
  const { t } = useCtx();
  const ref = useRef<HTMLDialogElement>(null);
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState<"number" | "passkey" | null>(null);
  const [err, setErr] = useState("");
  const withKey = hasPasskey && passkeysSupported();
  // a modal dialog: the page behind cannot be reached, Escape cancels, focus comes back to the button that asked
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const confirm = async (how: "number" | "passkey") => {
    if (busy) return;
    setBusy(how);
    setErr("");
    try {
      if (how === "passkey") await api.verify({ credential: await usePasskey(await api.verifyOptions()) });
      else await api.verify({ account_number: number });
      ref.current?.close();
      onDone();
    } catch (x) {
      setErr(errorText(t, passkeyErrorCode(x) ?? (x instanceof ApiError ? x.code : "unknown")));
      setBusy(null);
    }
  };
  const cancel = (e?: Event) => {
    e?.preventDefault();
    ref.current?.close();
    onCancel();
  };

  return (
    <dialog ref={ref} class="card verify-dialog stack" aria-labelledby="verify-title" onCancel={cancel} data-testid="reverify">
      <h2 id="verify-title">{t["verify.title"]}</h2>
      <p>{t["verify.body"]}</p>
      {withKey && (
        <>
          <button class="nb-button nb-button--primary" type="button" onClick={() => confirm("passkey")}
            disabled={busy === "number"} aria-disabled={busy === "passkey"} aria-busy={busy === "passkey"}>
            {busy === "passkey" ? <><Spin />{t["busy.passkey"]}</> : <><Icon name="passkey" />{t["verify.passkey"]}</>}
          </button>
          <p class="muted small center">{t["passkey.or"]}</p>
        </>
      )}
      <form class="stack-sm" method="post" onSubmit={(e) => { e.preventDefault(); void confirm("number"); }}>
        {/* the same fields as the sign-in page, so a password manager fills in the saved number */}
        <input class="sr-only" type="text" name="username" autoComplete="username" value={PM_USERNAME} readOnly
          tabIndex={-1} aria-hidden="true" />
        <label for="verify-number" class="strong">{t["login.label"]}</label>
        <input id="verify-number" class="nb-input nb-input--code mono" type="password" name="password" inputMode="numeric"
          autoComplete="current-password" required spellcheck={false} value={number} placeholder="0000 0000 0000 0000"
          onInput={(e) => setNumber(regroup(e.currentTarget, ACCOUNT))} />
        <button class={`nb-button${withKey ? "" : " nb-button--primary"}`} type="submit"
          disabled={busy === "passkey"} aria-disabled={busy === "number"} aria-busy={busy === "number"}>
          {busy === "number" ? <><Spin />{t["busy.verify"]}</> : t["verify.submit"]}
        </button>
      </form>
      {err && <p class="error" role="alert">{err}</p>}
      <button class="link-button" type="button" onClick={() => cancel()} disabled={busy !== null}>{t["verify.cancel"]}</button>
    </dialog>
  );
}
