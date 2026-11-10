// What a site in an inspection report is, written up and reviewed by hand (toomore/anoni-net-ws#480, the second layer of
// "網站的說明資料庫"). The data is data/site-notes.json; scripts/site-notes.mjs checks it in CI, and the lists page
// (/dns/lists/#site-notes) shows all of it.
//
// Three rules hold here, and tests/site-notes.spec.ts keeps them:
//
// - The whole file is in the page's bundle and a report's sites are matched against it in the reader's browser. Nothing
//   is ever asked of the server per site: that would tell the server which sites the device was seen on.
// - A note only adds to a report. It is read after the report has been judged and never goes back into it: an ad
//   network's note does not turn "needs a check" into "nothing found", nor change any severity, icon or reason.
// - The notes are a summary of what others published. Their words are put on the page as text, and their only links are
//   the `https://` sources in the file, opened in a new tab like the site's other links out.

import data from "./data/site-notes.json";

export interface SiteNote {
  /** A registered domain, lowercase: a name matches it if it is the domain or ends in `.domain`. */
  domain: string;
  /** One of `NOTE_CATEGORIES`; its name and what it means are in i18n, `notes.<category>.name` and `.about`. */
  category: string;
  /** Who runs it, where the sources say so: a company's name. */
  operator?: string;
  /** Where what the note says can be read, at least one, all `https://`. */
  sources: string[];
  /** The day it was last checked against its sources, `YYYY-MM-DD`; CI fails a year after it. */
  reviewed: string;
}

export const NOTE_CATEGORIES: readonly string[] = data.categories;
export const SITE_NOTES: readonly SiteNote[] = data.sites;

/**
 * The note for a name seen in a report: the one for its own domain or the closest one above it, so `a.magsrv.com` has
 * `magsrv.com`'s note and `notmagsrv.com` has none. Only reads the bundled notes, in the browser.
 */
export function noteFor(name: string | undefined, notes: readonly SiteNote[] = SITE_NOTES): SiteNote | null {
  if (!name) return null;
  const n = name.toLowerCase().replace(/\.$/, "");
  let best: SiteNote | null = null;
  for (const note of notes) {
    if ((n === note.domain || n.endsWith(`.${note.domain}`)) && (!best || note.domain.length > best.domain.length)) best = note;
  }
  return best;
}
