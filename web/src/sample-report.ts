import type { Report, Span } from "./pages/inspect.tsx";

// Two made-up reports for the sample page (/sample-report/), in the shape the analysis host writes: what someone who
// has not inspected a device yet can look through, and what anyone can be shown. Nothing in them comes from a person's
// report. The one real name, magsrv.com, is ExoClick's ad network, which the site notes describe from public sources;
// the rest are .example names, which cannot be anyone's.

// The week of 1 to 7 November 2026 on Taiwan's clock, the hours stored in UTC as the analysis host stores them
const START = Date.UTC(2026, 9, 31, 16);
const HOUR = 3_600_000;
const at = (day: number, hour: number) => START + (day * 24 + hour) * HOUR;
const hourOf = (ms: number) => new Date(ms).toISOString().slice(0, 13);
const secondsOf = (day: number, hour: number, minute = 0) => Math.floor((at(day, hour) + minute * 60_000) / 1000);

// An hour to a digit from midnight, 0 for no traffic to 5 for the most: the same week as the group page's example.
// Nights are empty but for a sync or two, mornings and evenings are the busy hours, and the VPN is off for some hours.
const WEEK = [
  "210000013322342123344310",
  "100000002433231002234421",
  "100200012322432133245300",
  "000000001232000001233410",
  "210000013423352423344520",
  "321000000012213122123453",
  "310000000001231012234310",
] as const;
const BYTES = [0, 3e5, 4e6, 2.2e7, 6e7, 1.5e8];

type Marks = Map<number, "x" | "!">;

function hours(marks: Marks, heavy: Set<number>, nights: Set<number>) {
  return WEEK.flatMap((row, day) => [...row].map((level, hour) => {
    const ms = at(day, hour);
    let total = BYTES[Number(level)];
    // the stalkerware's hours: a little traffic at night, when the phone should be asleep
    if (nights.has(ms) && !total) total = 2e6;
    const up = heavy.has(ms) ? 6.4e7 : Math.round(total * 0.14);
    return { hour: hourOf(ms), up, down: heavy.has(ms) ? 9e6 : total - Math.round(total * 0.14), mark: marks.get(ms) ?? null };
  })).filter((h) => h.up + h.down > 0);
}

const LISTS_AT = secondsOf(6, 21);
const CHECKS = (counts: Record<string, number>) =>
  ["spyware", "stalkerware", "malware", "cti", "bypass_dns"].map((id) => ({ id, count: counts[id] ?? 0 }));

// What both reports have beside the checks: a few unencrypted pages, a casting app looking for the TV, and one app
// that checks in every half hour
const OBSERVED = {
  plain: 4, old_tls: 0, ads_traffic_share: 0.06,
  odd_ports: 0, local: 3, tcp: { total: 2380, failed: 71 },
  random_nx: 0, carry: 2, dyndns: 0, hoster: 0,
};

/** A phone like most: two ad redirects one evening, both on the ad list too, and nothing after. */
export function sampleCheck(): Report {
  const evening = [at(2, 21), at(2, 22)];
  const marks: Marks = new Map(evening.map((ms) => [ms, "!"]));
  const report: Report = {
    first: secondsOf(0, 0, 4), last: secondsOf(6, 23, 52),
    hours: hours(marks, new Set(), new Set()),
    coverage: { active_hours: 0, total_hours: 168 },
    dns: { total: 18_420, nx_share: 0.031, ads_share: 0.214 },
    lists_at: LISTS_AT,
    checks: CHECKS({ malware: 1, cti: 3 }),
    findings: [
      { severity: "check", kind: "malware", name: "promo-redirect.example", count: 1, first: secondsOf(2, 21, 14), last: secondsOf(2, 21, 14),
        hours: [hourOf(evening[0])], lists: ["ads", "malware"], blocked: 1 },
      { severity: "check", kind: "cti", name: "magsrv.com", count: 3, first: secondsOf(2, 21, 15), last: secondsOf(2, 22, 7),
        hours: evening.map(hourOf), lists: ["ads", "cti"], blocked: 2 },
    ],
    more: {},
    ...OBSERVED,
    timers: { count: 1, minutes: 30 },
  };
  report.coverage!.active_hours = report.hours!.length;
  return report;
}

/** A phone with stalkerware: its server reached every night, at a steady interval, with uploads at night. */
export function sampleThreat(): Report {
  const nights = [0, 1, 2, 3, 4, 5, 6].flatMap((day) => [at(day, 2), at(day, 3)]).filter((_, i) => i % 3 !== 2);
  const heavy = new Set([at(2, 3), at(4, 2)]);
  const marks: Marks = new Map(nights.map((ms) => [ms, "x"]));
  const report: Report = {
    first: secondsOf(0, 0, 4), last: secondsOf(6, 23, 52),
    hours: hours(marks, heavy, new Set(nights)),
    coverage: { active_hours: 0, total_hours: 168 },
    dns: { total: 20_960, nx_share: 0.034, ads_share: 0.198 },
    lists_at: LISTS_AT,
    checks: CHECKS({ stalkerware: 26, cti: 3 }),
    findings: [
      { severity: "threat", kind: "stalkerware", name: "sync-collector.example", count: 26, first: secondsOf(0, 2, 11), last: Math.floor(nights.at(-1)! / 1000) + 2460,
        hours: nights.map(hourOf), lists: ["stalkerware"], blocked: 0 },
      { severity: "check", kind: "cti", name: "magsrv.com", count: 3, first: secondsOf(2, 21, 15), last: secondsOf(2, 22, 7),
        hours: [hourOf(at(2, 21)), hourOf(at(2, 22))], lists: ["ads", "cti"], blocked: 2 },
    ],
    more: {},
    ...OBSERVED,
    timers: { count: 2, minutes: 15 },
  };
  report.coverage!.active_hours = report.hours!.length;
  return report;
}

/** The sample week: seven days, ended. */
export const SAMPLE_SPAN: Span = { start: new Date(START), end: new Date(START + 7 * 24 * HOUR), days: 7 };
