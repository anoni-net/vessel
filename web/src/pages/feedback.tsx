import { useEffect, useState } from "preact/hooks";
import { checkLine, decodeCheck } from "../connection.ts";
import { useCtx } from "../context.ts";
import {
  CITIES,
  type Feedback as Answers,
  type FeedbackResult,
  KINDS,
  LIMITS,
  NETWORKS,
  PLATFORMS,
  feedbackPayload,
  feedbackReady,
  sendFeedback,
} from "../feedback.ts";
import { type MessageKey, fmt } from "../i18n/index.ts";

/** Optional single choice: a row of buttons, pressing the chosen one again clears it. */
function Pick<T extends string>({ name, options, value, onChange }: {
  name: "network" | "platform" | "city";
  options: readonly T[];
  value?: T;
  onChange: (v?: T) => void;
}) {
  const { t } = useCtx();
  return (
    <fieldset class="stack-sm">
      <legend class="strong">{t[`feedback.${name}` as MessageKey]} <span class="muted small">{t["feedback.optional"]}</span></legend>
      <div class="picks">
        {options.map((o) => (
          <button type="button" class={`tab${o === value ? " tab--on" : ""}`} aria-pressed={o === value}
            onClick={() => onChange(o === value ? undefined : o)}>
            {t[`feedback.${name}.${o}` as MessageKey]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function Feedback() {
  const { t, href, locale } = useCtx();
  const [f, setF] = useState<Answers>({ message: "", contact: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FeedbackResult | null>(null);
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<Answers>) => setF((old) => ({ ...old, ...patch }));
  // a result from the connection check (/check/), offered for the message; read after hydration, since the
  // prerendered page has no query string
  const [check, setCheck] = useState<ReturnType<typeof decodeCheck>>(null);
  const [attach, setAttach] = useState(true);
  useEffect(() => setCheck(decodeCheck(new URLSearchParams(location.search).get("check"))), []);
  const line = check ? checkLine(t, check.exit, check.dns) : "";

  const submit = async (e: Event) => {
    e.preventDefault();
    setTried(true);
    if (!feedbackReady(f)) return;
    setBusy(true);
    const from = typeof location === "undefined" ? "" : new URLSearchParams(location.search).get("from") ?? "";
    const message = line && attach ? `${f.message.trim()}\n\n${line}`.slice(0, LIMITS.message) : f.message;
    const r = await sendFeedback(feedbackPayload({ ...f, message }, locale, from));
    setBusy(false);
    setResult(r);
    if (r === "sent") window.scrollTo(0, 0);
  };

  if (result === "sent") {
    return (
      <section class="wrap narrow stack" data-testid="feedback-sent">
        <h1>{t["feedback.sent"]}</h1>
        <p>{t["feedback.sentBody"]}</p>
        <a class="nb-button nb-button--primary" href={href("/")}>{t["feedback.back"]}</a>
      </section>
    );
  }

  const short = f.message.trim().length < LIMITS.messageMin;
  return (
    <section class="wrap narrow">
      <h1>{t["feedback.title"]}</h1>
      <p class="feedback-lead">{t["feedback.lead"]}</p>
      <form class="stack" onSubmit={submit} noValidate>
        <fieldset class="stack-sm">
          <legend class="strong">{t["feedback.kind"]}</legend>
          {KINDS.map((k) => (
            <label class={`choice choice--radio${k === f.kind ? " choice--on" : ""}`}>
              <input type="radio" name="kind" value={k} checked={k === f.kind} onChange={() => set({ kind: k })} />
              <span class="strong">{t[`feedback.kind.${k}`]}</span>
            </label>
          ))}
          {tried && !f.kind && <p class="error" role="alert">{t["feedback.needKind"]}</p>}
        </fieldset>

        <label for="fb-message" class="strong">{t["feedback.message"]}</label>
        <textarea id="fb-message" class="nb-input nb-textarea" rows={6} maxLength={LIMITS.message} required
          placeholder={t["feedback.messagePh"]} value={f.message} aria-describedby="fb-message-hint"
          onInput={(e) => set({ message: e.currentTarget.value })} />
        <p id="fb-message-hint" class="muted small">{t["feedback.messageHint"]}</p>
        {tried && short && <p class="error" role="alert">{fmt(t["feedback.tooShort"], { n: LIMITS.messageMin })}</p>}
        {line && (
          <label class={`choice choice--radio${attach ? " choice--on" : ""}`} data-testid="attach-check">
            <input type="checkbox" checked={attach} onChange={() => setAttach(!attach)} />
            <span>
              <span class="strong">{t["feedback.attachCheck"]}</span>
              <br />
              <span class="muted small">{line}</span>
            </span>
          </label>
        )}

        <Pick name="network" options={NETWORKS} value={f.network} onChange={(network) => set({ network })} />
        <Pick name="platform" options={PLATFORMS} value={f.platform} onChange={(platform) => set({ platform })} />
        <Pick name="city" options={CITIES} value={f.city} onChange={(city) => set({ city })} />

        <label for="fb-contact" class="strong">{t["feedback.contact"]} <span class="muted small">{t["feedback.optional"]}</span></label>
        <input id="fb-contact" class="nb-input" type="text" maxLength={LIMITS.contact} autoComplete="off"
          placeholder={t["feedback.contactPh"]} value={f.contact} aria-describedby="fb-contact-hint"
          onInput={(e) => set({ contact: e.currentTarget.value })} />
        <p id="fb-contact-hint" class="muted small">{t["feedback.contactHint"]}</p>

        <p class="card card--tint card--flat small">{t["feedback.privacy"]}</p>
        {result && (
          <p class="error" role="alert">{t[result === "closed" ? "feedback.closed" : "feedback.failed"]}</p>
        )}
        <button class="nb-button nb-button--primary" type="submit" disabled={busy}>
          {busy ? t["feedback.sending"] : t["feedback.submit"]}
        </button>
      </form>
    </section>
  );
}
