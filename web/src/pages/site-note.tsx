import { fmt } from "../i18n/fmt.ts";
import type { MessageKey, T } from "../i18n/index.ts";
import type { SiteNote } from "../site-notes.ts";

/** A category's name and its one sentence, from i18n. */
export const noteName = (t: T, category: string) => t[`notes.${category}.name` as MessageKey];
export const noteAbout = (t: T, category: string) => t[`notes.${category}.about` as MessageKey];

/** A source's host, the words of its link: says where it goes without putting a whole address in the text. */
export const sourceHost = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** Only an `https://` address from the file is ever a link (scripts/site-notes.mjs refuses anything else too). */
const isSource = (url: string) => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

/** The sources of a note as links out (`bare`: without "Sources:", under a column that says so), in a new tab like the site's other links out. */
export function NoteSources({ note, t, bare }: { note: SiteNote; t: T; bare?: boolean }) {
  const sources = note.sources.filter(isSource);
  return (
    <>
      {!bare && t[sources.length === 1 ? "notes.source" : "notes.sources"]}
      {sources.map((url, i) => (
        <>{i > 0 && t["inspect.lists.sep"]}<a href={url} target="_blank" rel="noopener">{sourceHost(url)}</a></>
      ))}
    </>
  );
}

/**
 * What a site in a report is, in one short line: "Ad network ExoClick · Source: docs.exoclick.com". The category's sentence
 * is said once under the kind (`NoteCategories`), not on every site. Every word from the file is a text node, never
 * markup, and the line only describes the site: it is drawn beside a finding whose severity is already decided.
 */
export function NoteLine({ note, t, class: cls }: { note: SiteNote; t: T; class?: string }) {
  const name = noteName(t, note.category);
  const label = note.operator ? fmt(t["notes.withOperator"], { category: name, operator: note.operator }) : name;
  return (
    <span class={`site-note${cls ? ` ${cls}` : ""}`} data-testid="inspect-hit-note" data-category={note.category}>
      <span data-testid="inspect-note-text">{label}</span>
      <span class="muted" aria-hidden="true"> · </span>
      <span class="muted" data-testid="inspect-note-sources"><NoteSources note={note} t={t} /></span>
    </span>
  );
}

/**
 * The categories of the notes in one kind of finding, each said once with its sentence, in the order of the file: under
 * the kind, so a row of sites only needs its short line.
 */
export function NoteCategories({ notes, order, t }: { notes: readonly SiteNote[]; order: readonly string[]; t: T }) {
  const present = order.filter((c) => notes.some((n) => n.category === c));
  if (!present.length) return null;
  return (
    <div class="small site-note-categories" data-testid="inspect-kind-notes">
      <p>{t["inspect.notes.title"]}</p>
      <ul class="plain">
        {present.map((c) => <li data-category={c}>{fmt(t["notes.line"], { label: noteName(t, c), about: noteAbout(t, c) })}</li>)}
      </ul>
    </div>
  );
}
