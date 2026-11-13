import { useState } from "preact/hooks";
import { track } from "../analytics.ts";
import { useCtx } from "../context.ts";
import { type FeedbackResult, sendFeedback } from "../feedback.ts";
import { focusHeading } from "../focus.ts";
import {
  type GroupRequest,
  INSPECTS,
  KINDS,
  LIMITS,
  PERIODS,
  SIZES,
  requestPayload,
  requestReady,
} from "../group-apply.ts";
import type { MessageKey } from "../i18n/index.ts";
import { Spin } from "./skeleton.tsx";

type Choice = "kind" | "size" | "period";

/** Asking for group accounts: three things to choose, a way to be reached, and whatever the group wants to add.
 * Sent to the community's form server (group-apply.ts), never to the portal. */
export function GroupApply() {
  const { t, href, locale } = useCtx();
  const [r, setR] = useState<GroupRequest>({ group: "", message: "", contact: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FeedbackResult | null>(null);
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<GroupRequest>) => setR((old) => ({ ...old, ...patch }));

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setTried(true);
    if (!requestReady(r)) {
      // start at the first thing to fix, its message next to it
      const missing = (["kind", "size", "period"] as const).find((name) => !r[name]);
      (missing ? document.querySelector<HTMLInputElement>(`input[name="${missing}"]`) : document.getElementById("ga-contact"))?.focus();
      return;
    }
    setBusy(true);
    const sent = await sendFeedback(requestPayload(r, locale));
    setBusy(false);
    setResult(sent);
    if (sent === "sent") {
      // a count of requests sent, with nothing about the group
      track("group-apply");
      window.scrollTo(0, 0);
      focusHeading();
    }
  };

  if (result === "sent") {
    return (
      <section class="wrap narrow stack" data-testid="group-apply-sent">
        <h1>{t["groupApply.sent"]}</h1>
        <p>{t["groupApply.sentBody"]}</p>
        <a class="nb-button nb-button--primary" href={href("/for-groups/")}>{t["groupApply.back"]}</a>
      </section>
    );
  }

  const pick = <T extends string>(name: Choice, options: readonly T[], value: T | undefined) => (
    <fieldset class="stack-sm" aria-describedby={tried && !value ? `ga-${name}-error` : undefined}>
      <legend class="strong">{t[`groupApply.${name}`]}</legend>
      {options.map((o) => (
        <label class={`choice choice--radio${o === value ? " choice--on" : ""}`}>
          <input type="radio" name={name} value={o} checked={o === value} onChange={() => set({ [name]: o })} />
          <span>{t[`groupApply.${name}.${o}` as MessageKey]}</span>
        </label>
      ))}
      {tried && !value && <p class="error" role="alert" id={`ga-${name}-error`}>{t["pickup.needChoice"]}</p>}
    </fieldset>
  );

  const noContact = !r.contact.trim();
  return (
    <section class="wrap narrow">
      <h1>{t["groupApply.title"]}</h1>
      <p class="feedback-lead">{t["groupApply.lead"]}</p>
      <p class="small"><a href={href("/for-groups/")}>{t["home.groups.link"]}</a></p>
      <form class="stack" onSubmit={submit} noValidate>
        {pick("kind", KINDS, r.kind)}
        {pick("size", SIZES, r.size)}
        {pick("period", PERIODS, r.period)}

        <fieldset class="stack-sm">
          <legend class="strong">{t["groupApply.inspect"]} <span class="muted small">{t["feedback.optional"]}</span></legend>
          <div class="picks">
            {INSPECTS.map((o) => (
              <button type="button" class={`tab${o === r.inspect ? " tab--on" : ""}`} aria-pressed={o === r.inspect}
                onClick={() => set({ inspect: o === r.inspect ? undefined : o })}>
                {t[`groupApply.inspect.${o}`]}
              </button>
            ))}
          </div>
          <p class="muted small">{t["groupApply.inspectHint"]}</p>
        </fieldset>

        <label for="ga-group" class="strong">{t["groupApply.group"]} <span class="muted small">{t["feedback.optional"]}</span></label>
        <input id="ga-group" class="nb-input" type="text" maxLength={LIMITS.group} autoComplete="off" value={r.group}
          aria-describedby="ga-group-hint" onInput={(e) => set({ group: e.currentTarget.value })} />
        <p id="ga-group-hint" class="muted small">{t["groupApply.groupHint"]}</p>

        <label for="ga-message" class="strong">{t["groupApply.message"]} <span class="muted small">{t["feedback.optional"]}</span></label>
        <textarea id="ga-message" class="nb-input nb-textarea" rows={4} maxLength={LIMITS.message} placeholder={t["groupApply.messagePh"]}
          value={r.message} aria-describedby="ga-message-hint" onInput={(e) => set({ message: e.currentTarget.value })} />
        <p id="ga-message-hint" class="muted small">{t["groupApply.messageHint"]}</p>

        <label for="ga-contact" class="strong">{t["groupApply.contact"]}</label>
        <input id="ga-contact" class="nb-input" type="text" maxLength={LIMITS.contact} autoComplete="off" required
          placeholder={t["groupApply.contactPh"]} value={r.contact} aria-invalid={tried && noContact ? true : undefined}
          aria-describedby={tried && noContact ? "ga-contact-error ga-contact-hint" : "ga-contact-hint"}
          onInput={(e) => set({ contact: e.currentTarget.value })} />
        <p id="ga-contact-hint" class="muted small">{t["groupApply.contactHint"]}</p>
        {tried && noContact && <p class="error" role="alert" id="ga-contact-error">{t["groupApply.needContact"]}</p>}

        <p class="card card--tint card--flat small">{t["groupApply.privacy"]}</p>
        {result && (
          <p class="error" role="alert">{t[result === "closed" ? "groupApply.closed" : "feedback.failed"]}</p>
        )}
        <button class="nb-button nb-button--primary" type="submit" aria-disabled={busy} aria-busy={busy}>
          {busy ? <><Spin />{t["feedback.sending"]}</> : t["groupApply.submit"]}
        </button>
      </form>
    </section>
  );
}
