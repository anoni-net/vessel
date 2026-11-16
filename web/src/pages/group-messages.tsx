import { useState } from "preact/hooks";
import { ApiError, type Group, type GroupMessage, api, wordsOf } from "../api.ts";
import { announce } from "../announce.ts";
import { useCtx } from "../context.ts";
import { formatDate, formatDay } from "../format.ts";
import { HTML_LANG, errorText, fmt } from "../i18n/index.ts";
import { Spin } from "./skeleton.tsx";

/**
 * The leaders' announcements to their group (app/groups.py): they show in every inbox of the group, members' and
 * leaders', without which leader wrote them. Writing one needs a recent sign-in, so `guard` may ask the leader to
 * confirm first; taking one down does not.
 */
export function GroupMessages({ group, guard }: { group: Group; guard: <R>(run: () => Promise<R>) => Promise<R> }) {
  const { t, locale } = useCtx();
  const [messages, setMessages] = useState<GroupMessage[]>(group.messages ?? []);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const limit = group.message_limit ?? 0;
  const full = messages.length >= limit;

  const fail = (x: unknown) => {
    // backing out of confirming who they are leaves the form as it was
    if (!(x instanceof ApiError && x.code === "verify_cancelled")) setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
  };
  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await guard(() => api.postGroupMessage(title, body, locale));
      setMessages(r.messages);
      setOpen(false);
      setTitle("");
      setBody("");
      announce(t["group.messages.posted"]);
    } catch (x) {
      fail(x);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (m: GroupMessage) => {
    if (!window.confirm(t["group.messages.deleteConfirm"])) return;
    setErr("");
    try {
      setMessages((await api.deleteGroupMessage(m.id)).messages);
      announce(t["group.messages.deleted"]);
    } catch (x) {
      fail(x);
    }
  };

  return (
    <div class="stack account-section" data-testid="group-messages">
      <h2>{t["group.messages.title"]}</h2>
      <p>{fmt(t["group.messages.body"], { limit, days: group.message_days ?? 0 })}</p>
      {open ? (
        <form class="stack" onSubmit={submit} data-testid="group-message-form">
          <label class="stack-sm">
            <span class="strong">{t["group.messages.titleLabel"]}</span>
            <input class="nb-input" required maxLength={80} value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
          </label>
          <label class="stack-sm">
            <span class="strong">{t["group.messages.bodyLabel"]}</span>
            <textarea class="nb-input" required maxLength={1000} rows={5} value={body} onInput={(e) => setBody(e.currentTarget.value)} />
          </label>
          <p class="muted small">{t["group.messages.hint"]}</p>
          <button class="nb-button nb-button--ink" type="submit" aria-disabled={busy} aria-busy={busy}>
            {busy ? <><Spin />{t["busy.message"]}</> : t["group.messages.submit"]}
          </button>
          <button class="link-button" type="button" onClick={() => { setOpen(false); setErr(""); }}>{t["group.messages.cancel"]}</button>
        </form>
      ) : full ? (
        <p class="muted" data-testid="group-messages-full">{fmt(t["group.messages.full"], { limit })}</p>
      ) : (
        <button class="nb-button nb-button--ink" type="button" onClick={() => setOpen(true)}>{t["group.messages.open"]}</button>
      )}
      {err && <p class="error" role="alert">{err}</p>}
      {messages.length > 0 && (
        <ul class="stack plain" data-testid="group-messages-list">
          {messages.map((m) => {
            const [lang, words] = wordsOf(m.texts, locale);
            return (
              <li class="card card--flat inbox-item">
                <span class="muted small">
                  {fmt(t["group.messages.dates"], { made: formatDay(locale, m.created_at), until: formatDate(locale, m.expires_on) })}
                </span>
                <div class="inbox-item" lang={lang === locale ? undefined : HTML_LANG[lang]}>
                  <h3>{words.title}</h3>
                  {words.body.split(/\n\s*\n/).map((para) => <p class="inbox-body">{para}</p>)}
                </div>
                <p class="small">
                  <button class="link-button" type="button" onClick={() => remove(m)}
                    aria-label={`${t["group.messages.delete"]}: ${words.title}`}>{t["group.messages.delete"]}</button>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
