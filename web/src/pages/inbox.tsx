import { useEffect, useState } from "preact/hooks";
import { ApiError, type Inbox as InboxData, type InboxMessage, type InboxNote, api, last, wordsOf } from "../api.ts";
import { useCtx } from "../context.ts";
import { formatDate, formatDay } from "../format.ts";
import { HTML_LANG, type MessageKey, errorText, fmt } from "../i18n/index.ts";
import { markSeen, seenNotes } from "../inbox-state.ts";
import { joinNames } from "../reach.ts";
import { navigate } from "../router.ts";
import { setSignedIn } from "../session.ts";
import { AccountNav } from "./account.tsx";
import { Busy, SkLine } from "./skeleton.tsx";

/**
 * The inbox (app/inbox.py): notes about the account's own devices and invites, then the announcements. Opening it
 * reads everything: the announcements on the server, the notes in this browser. What was new when the page opened
 * keeps its mark until the person leaves.
 */
export function Inbox() {
  const { t, href } = useCtx();
  const [inbox, setInbox] = useState<InboxData | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await api.inbox();
        // which notes are new, read before they are marked seen
        const known = seenNotes();
        const keys = data.notes.map((n) => n.key);
        setFresh(new Set(keys.filter((k) => !known.has(k))));
        setInbox(data);
        markSeen(keys);
        if (data.messages.some((m) => m.unread)) await api.readInbox().catch(() => undefined);
        // the count beside the link goes to nothing
        await api.me().catch(() => undefined);
      } catch (x) {
        if (x instanceof ApiError && x.code === "signed_out") {
          setSignedIn(false);
          navigate(href("/login/"), true);
        } else setErr(errorText(t, x instanceof ApiError ? x.code : "unknown"));
      }
    })();
  }, []);

  return (
    <section class="wrap narrow stack inbox-page" aria-busy={!inbox && !err}>
      <AccountNav leader={last.me?.group?.role === "leader"} />
      <h1>{t["inbox.title"]}</h1>
      <p>{t["inbox.intro"]}</p>
      {err && <p class="error" role="alert">{err}</p>}
      {!inbox && !err && (
        <div class="stack" aria-hidden="true">
          <div class="card card--flat"><SkLine w="long" /><SkLine w="mid" /></div>
          <Busy />
        </div>
      )}
      {inbox && (
        <>
          <h2>{t["inbox.notes"]}</h2>
          {inbox.notes.length === 0
            ? <p class="card card--dashed" data-testid="inbox-notes-none">{t["inbox.notesNone"]}</p>
            : (
              <ul class="plain stack" data-testid="inbox-notes">
                {inbox.notes.map((n) => <li><Note note={n} fresh={fresh.has(n.key)} /></li>)}
              </ul>
            )}
          <h2>{t["inbox.messages"]}</h2>
          {inbox.messages.length === 0
            ? <p class="card card--dashed" data-testid="inbox-messages-none">{t["inbox.messagesNone"]}</p>
            : (
              <ul class="plain stack" data-testid="inbox-messages">
                {inbox.messages.map((m) => <li><Message message={m} /></li>)}
              </ul>
            )}
        </>
      )}
    </section>
  );
}

function NewMark() {
  const { t } = useCtx();
  return <span class="badge">{t["inbox.new"]}</span>;
}

function Note({ note, fresh }: { note: InboxNote; fresh: boolean }) {
  const { t, href, locale } = useCtx();
  const day = (iso: string) => formatDate(locale, iso);
  const city = (id: string) => t[`region.${id}` as MessageKey] ?? id;
  const [text, link, to] = ((): [string, MessageKey, string] => {
    switch (note.kind) {
      case "report":
        return [fmt(t["inbox.note.report"], { name: note.name, date: day(note.until) }), "inbox.link.report",
          `/devices/inspect/?d=${encodeURIComponent(note.device)}`];
      case "inspect_request":
        return [fmt(t["inbox.note.inspect_request"], { name: note.name, date: day(note.until) }), "inbox.link.request",
          `/devices/inspect/?d=${encodeURIComponent(note.device)}`];
      case "moved":
        return [fmt(t["inbox.note.moved"], {
          city: city(note.region), date: day(note.until),
          names: joinNames(locale, note.names.map((n) => fmt(t["inbox.quoted"], { name: n }))),
        }), "inbox.link.devices", "/devices/"];
      case "throttled":
        return [t["inbox.note.throttled"], "inbox.link.devices", "/devices/"];
      case "group_closing":
        return [fmt(t["inbox.note.group_closing"], { date: day(note.until) }), "inbox.link.devices", "/devices/"];
      case "invites":
        return [fmt(t["inbox.note.invites"], { n: note.left }), "inbox.link.invites", "/account/"];
    }
  })();
  return (
    <div class={`card card--flat inbox-item${fresh ? " card--tint" : ""}`} data-testid="inbox-note" data-kind={note.kind}>
      {fresh && <div class="row"><NewMark /></div>}
      <p>{text}</p>
      <p class="small"><a class="strong" href={href(to)}>{t[link]}</a></p>
    </div>
  );
}

function Message({ message }: { message: InboxMessage }) {
  const { t, locale } = useCtx();
  const [lang, words] = wordsOf(message.texts, locale);
  const to = message.from_leader ? t["inbox.to.leaders"]
    : message.region ? fmt(t["inbox.to.region"], { city: t[`region.${message.region}` as MessageKey] ?? message.region })
    : message.group ? t["inbox.to.group"] : t["inbox.to.all"];
  return (
    <article class={`card card--flat inbox-item${message.unread ? " card--tint" : ""}`} data-testid="inbox-message">
      <div class="row">
        <span class="muted small">{formatDay(locale, message.created_at)} · {to}</span>
        {message.unread && <NewMark />}
      </div>
      <div class="inbox-item" lang={lang === locale ? undefined : HTML_LANG[lang]}>
        <h3>{words.title}</h3>
        {/* plain text as the maintainers wrote it: a blank line starts a paragraph, a line break stays */}
        {words.body.split(/\n\s*\n/).map((para) => <p class="inbox-body">{para}</p>)}
      </div>
      {/* the maintainers write zh-TW at least; a leader writes one language, which the group shares */}
      {lang !== locale && !message.from_leader && <p class="muted small">{t["inbox.onlyTraditional"]}</p>}
    </article>
  );
}
