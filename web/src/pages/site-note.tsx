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
 * What a site in a report is: "Ad network ExoClick: …", then its sources. Every word from the file is a text node, never
 * markup, and the line only describes the site: it is drawn beside a finding whose severity is already decided.
 */
export function NoteLine({ note, t, class: cls }: { note: SiteNote; t: T; class?: string }) {
  const name = noteName(t, note.category);
  const label = note.operator ? fmt(t["notes.withOperator"], { category: name, operator: note.operator }) : name;
  return (
    <span class={`site-note${cls ? ` ${cls}` : ""}`} data-testid="inspect-hit-note" data-category={note.category}>
      <span data-testid="inspect-note-text">{fmt(t["notes.line"], { label, about: noteAbout(t, note.category) })}</span>
      <span class="muted site-note__sources" data-testid="inspect-note-sources"><NoteSources note={note} t={t} /></span>
    </span>
  );
}
