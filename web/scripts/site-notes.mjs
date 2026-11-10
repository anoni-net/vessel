#!/usr/bin/env node
// Checks the notes on sites (src/data/site-notes.json) before they are published with the pages: CI runs it, and
// tests/site-notes.spec.ts calls `check` with broken data to see that it fails.
//
//   node scripts/site-notes.mjs [--data FILE] [--i18n DIR] [--today YYYY-MM-DD]
//
// What it asks of the file:
// - `categories`: distinct codes, each with a name and a sentence in every language (`notes.<code>.name`, `.about`)
// - `sites`: each a lowercase registered domain, once only, of a listed category, with at least one `https://` source,
//   reviewed on a day that is not after today (a day of leeway for time zones ahead of UTC) and not more than a year
//   before it
// - nothing that a page would have to render as markup: the words are put on the page as text, and are checked here too
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const LOCALES = ["zh-TW", "zh-CN", "en"];
const SITE_KEYS = new Set(["domain", "category", "operator", "sources", "reviewed"]);
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
// a top-level domain is letters, or an internationalised one in its xn-- form
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
// markup or control characters: none of them belongs in a company's name or a sentence about a category
const UNSAFE = /[<>\u0000-\u001f\u007f]/;

/** Whether `name` is a lowercase domain of at least two labels. */
export function isDomain(name) {
  if (typeof name !== "string" || name.length > 253 || name !== name.toLowerCase()) return false;
  const labels = name.split(".");
  return labels.length >= 2 && labels.every((l) => LABEL.test(l)) && TLD.test(labels.at(-1));
}

/** `YYYY-MM-DD` as a day, or null when it is not a real one. */
function day(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text ? null : d;
}

/** The same day a year earlier (28 February for a 29th). */
function yearBefore(d) {
  const back = new Date(d);
  back.setUTCFullYear(d.getUTCFullYear() - 1);
  if (back.getUTCMonth() !== d.getUTCMonth()) back.setUTCDate(0);
  return back;
}

/**
 * Everything wrong with the notes, as lines to print; none when they are fine.
 * `messages`: the i18n files by locale. `today`: `YYYY-MM-DD`.
 */
export function check(data, messages, today) {
  const errors = [];
  const now = day(today);
  if (!now) return [`today is not a day: ${today}`];
  if (!data || typeof data !== "object" || Array.isArray(data)) return ["the file is not an object with `categories` and `sites`"];
  const extra = Object.keys(data).filter((k) => k !== "categories" && k !== "sites");
  if (extra.length) errors.push(`unknown keys at the top: ${extra.join(", ")}`);

  const categories = Array.isArray(data.categories) ? data.categories : [];
  if (!Array.isArray(data.categories) || !categories.length) errors.push("`categories` is not a list of category codes");
  const seenCategory = new Set();
  for (const c of categories) {
    if (typeof c !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c)) {
      errors.push(`category ${JSON.stringify(c)}: a code is lowercase letters, digits and hyphens`);
      continue;
    }
    if (seenCategory.has(c)) errors.push(`category ${c}: listed twice`);
    seenCategory.add(c);
    for (const locale of LOCALES) {
      for (const part of ["name", "about"]) {
        const key = `notes.${c}.${part}`;
        const text = messages[locale]?.[key];
        if (typeof text !== "string" || !text.trim()) errors.push(`category ${c}: ${locale} has no ${key}`);
        else if (UNSAFE.test(text)) errors.push(`category ${c}: ${locale} ${key} has markup or control characters`);
      }
    }
  }

  if (!Array.isArray(data.sites)) {
    errors.push("`sites` is not a list");
    return errors;
  }
  const seenDomain = new Set();
  const oldest = yearBefore(now);
  // a day ahead of today is let through: a note reviewed in the morning in Taipei is dated a day UTC has not reached
  const latest = new Date(now.getTime() + 86_400_000);
  data.sites.forEach((site, i) => {
    const at = `site ${i + 1}${site && typeof site.domain === "string" ? ` (${site.domain})` : ""}`;
    if (!site || typeof site !== "object" || Array.isArray(site)) {
      errors.push(`${at}: not an object`);
      return;
    }
    const unknown = Object.keys(site).filter((k) => !SITE_KEYS.has(k));
    if (unknown.length) errors.push(`${at}: unknown keys ${unknown.join(", ")}`);

    if (!isDomain(site.domain)) errors.push(`${at}: the domain is not a lowercase domain such as example.com`);
    else if (seenDomain.has(site.domain)) errors.push(`${at}: listed twice`);
    else seenDomain.add(site.domain);

    if (!seenCategory.has(site.category)) errors.push(`${at}: the category ${JSON.stringify(site.category)} is not in \`categories\``);

    if ("operator" in site && (typeof site.operator !== "string" || !site.operator.trim() || site.operator.length > 80 || UNSAFE.test(site.operator))) {
      errors.push(`${at}: the operator is a company's name, up to 80 characters, without markup`);
    }

    if (!Array.isArray(site.sources) || !site.sources.length) errors.push(`${at}: no source; every note needs at least one https:// link`);
    else {
      if (new Set(site.sources).size !== site.sources.length) errors.push(`${at}: a source is listed twice`);
      for (const s of site.sources) {
        let url = null;
        try {
          url = typeof s === "string" ? new URL(s) : null;
        } catch {
          /* said below */
        }
        if (!url || url.protocol !== "https:" || !s.startsWith("https://") || url.username || url.password || UNSAFE.test(s) || /\s/.test(s)) {
          errors.push(`${at}: the source ${JSON.stringify(s)} is not an https:// address`);
        }
      }
    }

    const reviewed = day(site.reviewed);
    if (!reviewed) errors.push(`${at}: reviewed is not a day, YYYY-MM-DD`);
    else if (reviewed > latest) errors.push(`${at}: reviewed ${site.reviewed} is after today (${today})`);
    else if (reviewed < oldest) errors.push(`${at}: reviewed ${site.reviewed} is more than a year ago; check the sources again and set the day it was checked`);
  });
  return errors;
}

function main(argv) {
  const opt = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const file = opt("--data", join(HERE, "../src/data/site-notes.json"));
  const dir = opt("--i18n", join(HERE, "../src/i18n"));
  const today = opt("--today", new Date().toISOString().slice(0, 10));
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf-8"));
  } catch (x) {
    console.error(`site-notes: cannot read ${file}: ${x.message}`);
    return 1;
  }
  const messages = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(readFileSync(join(dir, `${l}.json`), "utf-8"))]));
  const errors = check(data, messages, today);
  if (errors.length) {
    for (const e of errors) console.error(`site-notes: ${e}`);
    return 1;
  }
  console.log(`site-notes: ${data.sites.length} sites in ${data.categories.length} categories, all fine`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
