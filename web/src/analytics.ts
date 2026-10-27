import { ApiError } from "./api.ts";

// Statistics go to the community's self-hosted Umami (aa.anoni.net, website anoni-net/vessel). The
// Umami script is not loaded; this posts straight to /api/send, and the CSP allows only that URL.
//
// Two kinds are sent. Page views, only for the paths in PUBLIC. Events for each step of redeeming,
// signing in and creating a device, with their results, so problems along that path show up. An
// event may carry only the fields and values in EVENTS, or nothing is sent. The database keeps each
// account's creation date and Umami adds a country to every event, so events never carry what the
// database also has: no account number, device name, region, DNS filter or key. The platform the
// visitor picked is the one detail they carry that the database does not.
//
// Each request carries the path without query or hash, the language and the screen rounded to
// hundreds; the first page view also carries the referring site's host. Nothing is sent off
// vessel.anoni.net (local preview and tests), when the browser sends Do Not Track or Global Privacy
// Control, or after the visitor turns it off in the footer (kept in this browser's localStorage).
// Failures are dropped.

export const ANALYTICS_ENDPOINT = "https://aa.anoni.net/api/send";
const WEBSITE = "42ebaa59-2ce5-441a-a4e9-54960b23d784";
const HOST = "vessel.anoni.net";
const OPT_OUT = "vessel-analytics-off";

export const PUBLIC = new Set(["/", "/faq/", "/terms/", "/privacy/", "/redeem/", "/login/"]);

const PLATFORMS = ["android", "apple", "windows"];
// error codes the pages already translate; anything else is "other"
const RESULTS = [
  "ok", "invalid_invite", "full", "redeem_paused", "too_many_attempts", "invalid_number", "signed_out", "network",
  "missing_header", "unknown", "device_limit", "region_closed", "invalid_name", "invalid_key", "key_in_use",
  "quota_exceeded", "node_failed", "not_found", "config_gone", "timeout", "other",
];

export const EVENTS: Record<string, Record<string, readonly string[]>> = {
  redeem: { result: RESULTS },
  "number-continue": {},
  login: { result: RESULTS },
  "device-step": { step: ["install", "region", "name", "config"], platform: PLATFORMS },
  "device-create": { result: RESULTS, platform: PLATFORMS },
  "device-config": { how: ["download", "qr", "text", "done"] },
};

/** The data back when it has exactly the listed fields with listed values, otherwise null. */
export function scrub(name: string, data: Record<string, string>): Record<string, string> | null {
  const spec = EVENTS[name];
  if (!spec) return null;
  const keys = Object.keys(spec);
  if (Object.keys(data).length !== keys.length) return null;
  for (const key of keys) {
    if (!Object.hasOwn(data, key) || !spec[key]!.includes(data[key]!)) return null;
  }
  return { ...data };
}

export function resultOf(x: unknown): string {
  const code = x instanceof ApiError ? x.code : "unknown";
  return RESULTS.includes(code) ? code : "other";
}

export function coarseScreen(width: number, height: number): string {
  const floor = (n: number) => Math.max(100, Math.floor(n / 100) * 100);
  return `${floor(width)}x${floor(height)}`;
}

export function referrerHost(referrer: string, self: string): string {
  try {
    const url = new URL(referrer);
    return url.host === self ? "" : `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

export function browserDeclines(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

let sessionOff: boolean | null = null;

export function optedOut(): boolean {
  if (sessionOff !== null) return sessionOff;
  try {
    return localStorage.getItem(OPT_OUT) === "1";
  } catch {
    return false;
  }
}

export function setOptedOut(off: boolean) {
  sessionOff = off;
  try {
    if (off) localStorage.setItem(OPT_OUT, "1");
    else localStorage.removeItem(OPT_OUT);
  } catch {
    // storage blocked (private windows): the choice still holds for this page
  }
}

let firstView = true;

function enabled(): boolean {
  return location.hostname === HOST && !browserDeclines() && !optedOut();
}

function send(extra: { name?: string; data?: Record<string, string> }) {
  const payload = {
    website: WEBSITE,
    hostname: HOST,
    language: navigator.language,
    screen: coarseScreen(screen.width, screen.height),
    url: location.pathname,
    // only the first page view says where the visitor came from
    referrer: firstView && !extra.name ? referrerHost(document.referrer, location.host) : "",
    ...extra,
  };
  if (!extra.name) firstView = false;
  fetch(ANALYTICS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "event", payload }),
    keepalive: true,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  }).catch(() => {});
}

/** `path` is the page without its locale prefix; the full pathname is what gets sent. */
export function trackView(path: string) {
  if (enabled() && PUBLIC.has(path)) send({});
}

export function track(name: string, data: Record<string, string> = {}) {
  const clean = scrub(name, data);
  if (enabled() && clean) send(Object.keys(clean).length ? { name, data: clean } : { name });
}
