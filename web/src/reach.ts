// Which common sites each node can open (node/host/vessel-reach.py, read by the worker into /api/status). A site
// counts for a city only when that city's node cannot open it and another city's can: a site no node opens is more
// likely down, or changed so that the check no longer recognises it, and saying "use another city" would not help.
import type { Locale } from "./i18n/index.ts";

export type ReachState = "ok" | "challenge" | "blocked";
export interface Reach {
  region: string;
  checked_at: string;
  sites: Record<string, ReachState>;
}

/** The sites the node in `region` answers with `state`, among those another node opens. */
export function sitesHere(reach: Reach[], region: string, state: Exclude<ReachState, "ok">): string[] {
  const here = reach.find((r) => r.region === region);
  if (!here) return [];
  return Object.keys(here.sites).filter(
    (site) => here.sites[site] === state && reach.some((r) => r.region !== region && r.sites[site] === "ok"),
  );
}

/** The other cities whose nodes open every one of `sites`. */
export function citiesFor(reach: Reach[], region: string, sites: string[]): string[] {
  return reach.filter((r) => r.region !== region && sites.every((s) => r.sites[s] === "ok")).map((r) => r.region);
}

/** Names in a sentence: "A、B" in Chinese, "A, B" in English; `or` joins the last two with "or" ("或"). */
export function joinNames(locale: Locale, names: string[], or = false): string {
  if (locale === "en") {
    return new Intl.ListFormat("en", { type: or ? "disjunction" : "conjunction" }).format(names);
  }
  if (or && names.length > 1) return `${names.slice(0, -1).join("、")}或${names[names.length - 1]}`;
  return names.join("、");
}
