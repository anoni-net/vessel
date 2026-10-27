// Page views of the public pages go to the community's self-hosted Umami (aa.anoni.net, website
// anoni-net/vessel). The Umami script is not loaded; this posts straight to /api/send, and the CSP
// allows only that URL.
//
// Only the paths in PUBLIC are sent, and no events. The pages after sign-in and anything about an
// account or a device never leave the browser: the database keeps each account's creation date, and
// Umami's country for a "redeemed" event on the same day could tell which country an account came
// from. Sign-up and device numbers come from `app.admin stats` instead.
//
// Each view carries the path without query or hash, the language, the screen rounded to hundreds,
// and on the first view only the referring site's host. Nothing is sent off vessel.anoni.net (local
// preview and tests), when the browser sends Do Not Track or Global Privacy Control, or after the
// visitor turns it off in the footer (kept in this browser's localStorage). Failures are dropped.

export const ANALYTICS_ENDPOINT = "https://aa.anoni.net/api/send";
const WEBSITE = "42ebaa59-2ce5-441a-a4e9-54960b23d784";
const HOST = "vessel.anoni.net";
const OPT_OUT = "vessel-analytics-off";

export const PUBLIC = new Set(["/", "/faq/", "/terms/", "/privacy/", "/redeem/", "/login/"]);

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

/** `path` is the page without its locale prefix; the full pathname is what gets sent. */
export function trackView(path: string) {
  if (location.hostname !== HOST || !PUBLIC.has(path) || browserDeclines() || optedOut()) return;
  const payload = {
    website: WEBSITE,
    hostname: HOST,
    language: navigator.language,
    screen: coarseScreen(screen.width, screen.height),
    url: location.pathname,
    referrer: firstView ? referrerHost(document.referrer, location.host) : "",
  };
  firstView = false;
  fetch(ANALYTICS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "event", payload }),
    keepalive: true,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  }).catch(() => {});
}
