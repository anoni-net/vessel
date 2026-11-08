// Which common sites each node can open (node/host/vessel-reach.py, read by the worker into /api/status). A site
// counts for a city only when that city's node cannot open it and another city's can: a site no node opens is more
// likely down, or changed so that the check no longer recognises it, and saying "use another city" would not help.
import type { Locale } from "./i18n/index.ts";

export type ReachState = "ok" | "challenge" | "blocked";

// The sites by the region they serve, in the order the status page shows them: the column after the id in
// node/reach-sites.tsv (tests/status.spec.ts checks that the two match). People on Vessel live in many places, so
// the page lets each reader look at the sites of their own place instead of naming sites to everyone.
export const REACH_GROUPS = {
  global: ["signal", "telegram", "whatsapp", "torproject", "wikipedia", "proton", "google", "youtube", "chatgpt", "reddit", "instagram", "x", "spotify"],
  tw: ["cathaybk", "ctbc", "esun", "taishin", "bot", "post", "etax", "mvdis", "ris", "govtw", "cdc", "cec", "momo", "pchome", "ptt", "104", "litv", "anigamer"],
  hk: ["hsbchk", "hangseng", "bochk", "govhk", "ird", "hkpost"],
  mo: ["govmo"],
  jp: ["nhk", "rakuten", "mufg"],
  sg: ["singpass", "dbs"],
} as const;
export type ReachGroup = keyof typeof REACH_GROUPS;
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

/** Names in a sentence: "A、B" in Chinese, "A, B and C" in English. */
export function joinNames(locale: Locale, names: string[]): string {
  return locale === "en" ? new Intl.ListFormat("en", { type: "conjunction" }).format(names) : names.join("、");
}
