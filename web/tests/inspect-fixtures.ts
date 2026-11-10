import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import { x25519 } from "@noble/curves/ed25519.js";

/** The key the page keeps for a report, and which `seal` seals to. */
export const KEY = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=";

/** The same sealing as inspect/analyze.py's `seal`, for reports made up in the tests. */
export function seal(report: object) {
  const secret = randomBytes(32);
  const shared = x25519.getSharedSecret(secret, x25519.getPublicKey(Buffer.from(KEY, "base64")));
  const key = Buffer.from(hkdfSync("sha256", shared, new Uint8Array(0), "vessel-inspection-report", 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(report)), cipher.final(), cipher.getAuthTag()]);
  return { epk: Buffer.from(x25519.getPublicKey(secret)).toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64") };
}

const site = (kind: string, severity: string, i: number) => ({ severity, kind, name: `s${i}.example`, how: "DNS", count: 500 - i, first: 1762128000 });

/** A report with every part filled in: both kinds of finding, every step of the hours, both marks, names left out. */
export const FULL_REPORT = {
  first: 1762128000, last: 1762300800,
  hours: Array.from({ length: 48 }, (_, i) => {
    const up = 10 ** (3 + (i % 7));
    const day = 9 + Math.floor(i / 24);
    return { hour: `2026-11-${String(day).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}`, up, down: up * 3, mark: i % 24 === 7 ? "x" : i % 24 === 13 ? "!" : null };
  }),
  coverage: { active_hours: 48, total_hours: 48 },
  dns: { total: 12000, nx_share: 0.12, ads_share: 0.3 }, idle_share: 0.4,
  checks: [{ id: "stalkerware", count: 7 }, { id: "malware", count: 0 }, { id: "cti", count: 500 }, { id: "bypass_dns", count: 9 }],
  findings: [site("stalkerware", "threat", 0), site("stalkerware", "threat", 1), ...Array.from({ length: 4 }, (_, i) => site("cti", "check", i + 2)),
    { severity: "check", kind: "bypass_dns", count: 9 }],
  more: { cti: 4 },
  nx_names: [{ name: "gone.example", count: 12 }],
};

// Reports in the format analyze.py writes since 2026-11-10: each site says the hours it was seen in and when last, and
// there are no names that could not be found. The hours are UTC; the tests that read them run on Taipei's clock.

/** `2026-11-09T18` and so on: `n` hours from `from` (a UTC hour), one apart. */
const hoursFrom = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}:00:00Z`) + i * 3_600_000).toISOString().slice(0, 13));
const epoch = (hour: string, minutes = 0) => Date.parse(`${hour}:00:00Z`) / 1000 + minutes * 60;
const traffic = (hours: string[], marks: Record<string, "x" | "!"> = {}, heavy: string[] = []) =>
  hours.map((hour, i) => {
    const down = Math.round(2e6 * (1 + ((i * 7) % 11)) ** 1.6);
    return { hour, up: heavy.includes(hour) ? 35e6 : Math.round(down / 6), down: heavy.includes(hour) ? 8e6 : down, mark: marks[hour] ?? null };
  });
const hit = (kind: string, severity: string, name: string, count: number, hours: string[], minutes = 13) =>
  ({ severity, kind, name, how: "DNS", count, hours, last: epoch(hours.at(-1)!, minutes) });

/**
 * Like the maintainer's own first day: everything on the lists seen within a quarter of an hour, at 2 am Taipei time
 * (18:00 UTC), while browsing; twelve more hours of use after it, and one hour that sent more than it received.
 */
export const ONCE_START = "2026-11-09T17:50:00Z";
const onceHours = hoursFrom("2026-11-09T18", 13);
export const ONCE_REPORT = {
  first: epoch("2026-11-09T18", 2), last: epoch("2026-11-10T06", 40),
  hours: traffic(onceHours, { "2026-11-09T18": "!" }, ["2026-11-10T03"]),
  coverage: { active_hours: 13, total_hours: 13 },
  dns: { total: 2300, nx_share: 0.04, ads_share: 0.31 }, idle_share: 0.94,
  checks: [{ id: "stalkerware", count: 0 }, { id: "malware", count: 6 }, { id: "cti", count: 5 }, { id: "bypass_dns", count: 0 }],
  findings: [
    hit("malware", "check", "ads-redirect.example", 2, ["2026-11-09T18"], 3), hit("malware", "check", "popunder.example", 2, ["2026-11-09T18"], 4),
    hit("malware", "check", "click-track.example", 1, ["2026-11-09T18"], 9), hit("malware", "check", "banner-cdn.example", 1, ["2026-11-09T18"], 13),
    hit("cti", "check", "short-link.example", 2, ["2026-11-09T18"], 5), hit("cti", "check", "metrics.example", 1, ["2026-11-09T18"], 6),
    hit("cti", "check", "promo.example", 1, ["2026-11-09T18"], 11), hit("cti", "check", "pixel.example", 1, ["2026-11-09T18"], 12),
  ],
  more: {},
};

/** A week with one site seen on six of its seven days: 11/01 to 11/07 Taipei time, the device off on 11/04. */
export const WEEK_START = "2026-11-01T02:00:00Z";
const weekDays = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06", "2026-11-07"];
// 8 am to 11 pm Taipei time, 00:00 to 15:00 UTC
const weekHours = weekDays.flatMap((d) => hoursFrom(`${d}T00`, 16));
const beacon = weekDays.flatMap((d, i) => (i % 2 ? [`${d}T01`, `${d}T09`] : [`${d}T01`]));
export const WEEK_REPORT = {
  first: epoch("2026-11-01T00"), last: epoch("2026-11-07T15", 50),
  hours: traffic(weekHours, Object.fromEntries(beacon.map((h) => [h, "!"]))),
  coverage: { active_hours: weekHours.length, total_hours: 160 },
  dns: { total: 41000, nx_share: 0.03, ads_share: 0.22 }, idle_share: 0.02,
  checks: [{ id: "stalkerware", count: 0 }, { id: "malware", count: 1 }, { id: "cti", count: 31 }, { id: "bypass_dns", count: 0 }],
  findings: [hit("cti", "check", "beacon.example", 30, beacon), hit("cti", "check", "rare.example", 1, ["2026-11-03T05"]),
    hit("malware", "check", "ads-redirect.example", 1, ["2026-11-02T12"])],
  more: {},
};

/** Stalkerware seen on three days, with a lookup that went around Vessel. */
export const THREAT_REPORT = {
  ...WEEK_REPORT,
  checks: [{ id: "stalkerware", count: 9 }, { id: "malware", count: 0 }, { id: "cti", count: 0 }, { id: "bypass_dns", count: 4 }],
  findings: [hit("stalkerware", "threat", "collect.example", 9, ["2026-11-01T03", "2026-11-03T03", "2026-11-03T04", "2026-11-06T03"]),
    { severity: "check", kind: "bypass_dns", count: 4 }],
};

/** The same week with nothing found. */
export const CLEAN_REPORT = { ...WEEK_REPORT, hours: traffic(weekHours), checks: WEEK_REPORT.checks.map((c) => ({ ...c, count: 0 })), findings: [], more: {} };

/** More sites of one kind than the page draws before folding the rest away. */
export const MANY_REPORT = {
  ...WEEK_REPORT,
  checks: [{ id: "stalkerware", count: 0 }, { id: "malware", count: 0 }, { id: "cti", count: 8 }, { id: "bypass_dns", count: 0 }],
  findings: Array.from({ length: 8 }, (_, i) => hit("cti", "check", `site${i + 1}.example`, 8 - i, [`2026-11-0${1 + (i % 3)}T0${i % 6}`])),
};

// Reports from analyze.py since it compares a site with every list: each site says the lists its names are on, its own
// kind and the ad list included, sorted.
type Finding = { kind: string; [k: string]: unknown };
const onLists = (f: Finding, ...more: string[]) => ({ ...f, lists: [...new Set([f.kind, ...more])].sort() });

/**
 * The first day again, as the maintainer's own report was: most of the sites also on the ad list, one on three lists,
 * one on its own list only.
 */
export const ONCE_LISTS_REPORT = {
  ...ONCE_REPORT,
  findings: ONCE_REPORT.findings.map((f, i) => (i === 1 ? onLists(f, "ads", "cti") : i === 6 ? onLists(f) : onLists(f, "ads"))),
};

/** The first day with every site also on the ad list. */
export const ONCE_ADS_REPORT = { ...ONCE_REPORT, findings: ONCE_REPORT.findings.map((f) => onLists(f, "ads")) };

/** The week, every site also on the ad list: seen day after day all the same. */
export const WEEK_ADS_REPORT = { ...WEEK_REPORT, findings: WEEK_REPORT.findings.map((f) => onLists(f, "ads")) };

/** Stalkerware that an ad network's list has too. */
export const THREAT_ADS_REPORT = {
  ...THREAT_REPORT,
  findings: THREAT_REPORT.findings.map((f) => (f.kind === "stalkerware" ? onLists(f, "ads") : f)),
};

/** Stalkerware with the name of the app it belongs to, from Echap's table: a made-up name. */
export const THREAT_APP_REPORT = {
  ...THREAT_REPORT,
  findings: THREAT_REPORT.findings.map((f) => (f.kind === "stalkerware" ? { ...onLists(f), app: "FakeSpy" } : f)),
};

/** Two sites of two apps, one of them with markup in its name, which the page shows as it is. */
export const THREAT_APPS_REPORT = {
  ...THREAT_REPORT,
  checks: [{ id: "stalkerware", count: 11 }, ...THREAT_REPORT.checks.slice(1)],
  findings: [{ ...onLists(THREAT_REPORT.findings[0]), app: "FakeSpy" },
    { ...hit("stalkerware", "threat", "upload.example", 2, ["2026-11-02T03"]), lists: ["stalkerware"], app: "<b>Spy</b> & Co" },
    THREAT_REPORT.findings[1]],
};

/** The first day, the sites seen across four hours of it, every one also on the ad list. */
export const ONE_DAY_ADS_REPORT = {
  ...ONCE_ADS_REPORT,
  findings: ONCE_ADS_REPORT.findings.map((f, i) => ({ ...f, hours: [`2026-11-09T${18 + (i % 4)}`], last: Date.parse(`2026-11-09T${18 + (i % 4)}:10:00Z`) / 1000 })),
};

// The notes on sites (src/data/site-notes.json) describe the sites the maintainer's own first day had: two of ad
// networks and two ad redirects. These are their domains, in the public file too.
export const NOTED = ["magsrv.com", "diffusedpassionquaking.com", "snaptrckr.fun", "opoxv.com"] as const;
const named = (f: Finding, name: string) => ({ ...f, name });

/**
 * The first day with those four sites, one of them seen under a name below its domain, and two that only look like
 * one: a name that merely ends the same way, and one without a note at all.
 */
export const NOTES_REPORT = {
  ...ONCE_ADS_REPORT,
  findings: ONCE_ADS_REPORT.findings.slice(0, 6).map((f, i) =>
    named(f, ["magsrv.com", "diffusedpassionquaking.com", "s10.snaptrckr.fun", "opoxv.com", "notmagsrv.com", "pixel.example"][i])),
  checks: [{ id: "stalkerware", count: 0 }, { id: "malware", count: 6 }, { id: "cti", count: 3 }, { id: "bypass_dns", count: 0 }],
};

/** Every site of the first day an ad network's, with a note: the report must still say it needs a check. */
export const AD_NETWORK_REPORT = {
  ...ONCE_ADS_REPORT,
  findings: ONCE_ADS_REPORT.findings.slice(0, 4).map((f, i) => named(f, ["magsrv.com", "a.magsrv.com", "diffusedpassionquaking.com", "s.magsrv.com"][i])),
  checks: [{ id: "stalkerware", count: 0 }, { id: "malware", count: 6 }, { id: "cti", count: 0 }, { id: "bypass_dns", count: 0 }],
};
/** The same report with names no note has: what the verdict is without any note. */
export const AD_NETWORK_UNNOTED = {
  ...AD_NETWORK_REPORT,
  findings: AD_NETWORK_REPORT.findings.map((f, i) => named(f, `unnoted${i}.example`)),
};
