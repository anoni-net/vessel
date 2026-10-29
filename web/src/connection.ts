// The connection check on /check/: does this browser's traffic leave through a Vessel node, and do its DNS
// lookups reach Vessel's resolvers? The exit part asks /api/exit, which compares the request's address with the
// nodes' and answers with a city or nothing; the DNS part is the check from /dns/ (dnscheck.ts). The result
// stays in the page unless the visitor chooses to attach it to their feedback.
import { api } from "./api.ts";
import type { Verdict } from "./dnscheck.ts";
import { type MessageKey, type T, fmt } from "./i18n/index.ts";

/** A region id when the request came through that node, or why it did not. */
export type Exit = string;
const EXIT_PROBLEMS = ["none", "ipv6", "error"] as const;
const VERDICTS: readonly Verdict[] = ["offline", "notVessel", "none", "malware", "ads", "mixed"];

export async function exitCheck(): Promise<Exit> {
  try {
    const r = await api.exit();
    if (r.ipv6) return "ipv6";
    return r.region ?? "none";
  } catch {
    return "error";
  }
}

export const passed = (exit: Exit, dns: Verdict) =>
  !(EXIT_PROBLEMS as readonly string[]).includes(exit) && (dns === "none" || dns === "malware" || dns === "ads");

/** The result as it travels to the feedback page: `?check=<exit>.<dns>` */
export const encodeCheck = (exit: Exit, dns: Verdict) => `${exit}.${dns}`;

export function decodeCheck(s: string | null): { exit: Exit; dns: Verdict } | null {
  const m = s ? /^([a-z]{2}|none|ipv6|error)\.([a-zA-Z]+)$/.exec(s) : null;
  if (!m || !VERDICTS.includes(m[2] as Verdict)) return null;
  return { exit: m[1], dns: m[2] as Verdict };
}

const city = (t: T, region: string) => t[`region.${region}` as MessageKey] ?? region;

/** The full sentence the check page shows for the exit. */
export function exitText(t: T, exit: Exit): string {
  if ((EXIT_PROBLEMS as readonly string[]).includes(exit)) return t[`check.exit.${exit}` as MessageKey];
  return fmt(t["check.exit.vessel"], { city: city(t, exit) });
}

/** One line for the feedback message, in the visitor's language. */
export function checkLine(t: T, exit: Exit, dns: Verdict): string {
  const e = (EXIT_PROBLEMS as readonly string[]).includes(exit)
    ? t[`check.short.exit.${exit}` as MessageKey]
    : fmt(t["check.short.exit.vessel"], { city: city(t, exit) });
  const d = dns === "none" || dns === "malware" || dns === "ads" ? t[`filter.${dns}`] : t[`check.short.dns.${dns}`];
  return fmt(t["check.line"], { exit: e, dns: d });
}
