import { type Page, expect, test } from "@playwright/test";
import axe from "axe-core";
import { FULL_REPORT, KEY, NOTES_REPORT, ONCE_ADS_REPORT, ONCE_LISTS_REPORT, ONCE_REPORT, THREAT_APP_REPORT, THREAT_REPORT, WEEK_START, seal } from "./inspect-fixtures.ts";

// WCAG 2.2 AA. axe-core checks what a tool can (names, roles, labels, contrast where it can tell the background);
// the tests after it cover what it cannot: the focus ring on the footer's dark blue, the narrowest phone, and
// motion that stops on its own.

const ME = { created_on: "2026-10-27", last_login_on: "2026-10-27", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 42e9 };
const DEVICES = [
  { id: "d-a", name: "phone", region: "jp", dns_filter: "ads", status: "active", created_on: "2026-10-28", expires_on: "2026-12-04",
    used_bytes: 3e9, blocked: 12, connected: true, ipv6: true, moved_until: null },
  { id: "d-b", name: "laptop", region: "sg", dns_filter: "none", status: "active", created_on: "2026-11-01", expires_on: "2026-12-04",
    used_bytes: 0, blocked: 0, connected: false, ipv6: false, moved_until: null },
];

const GROUP = {
  code: "g1", ends_on: "2030-01-01", closing_on: null, account_limit: 5, device_limit: 3, places_left: 3, invite_days: 7,
  accounts: [
    { label: "A1", role: "member", joined_on: "2026-11-01", devices: [{ id: "d-a", name: "phone", region: "jp", dns_filter: "malware",
      status: "active", expires_on: "2030-01-01", issues: ["new_config"] }] },
    { label: "L1", role: "leader", joined_on: "2026-10-27", devices: [] },
  ],
  invites: [{ id: 1, label: "A2", created_at: "2026-11-05T00:00:00Z", expires_at: "2026-11-12T00:00:00Z", expired: false }],
};

async function backend(page: Page, signedIn: boolean) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return signedIn ? route.fulfill({ json: ME }) : route.fulfill({ status: 401, json: { error: "signed_out" } });
    if (path === "/api/devices") return route.fulfill({ json: DEVICES });
    if (path === "/api/group") return route.fulfill({ json: GROUP });
    if (path === "/api/regions") return route.fulfill({ json: [{ id: "jp", open: true }, { id: "sg", open: true }] });
    if (path === "/api/status") return route.fulfill({ json: { regions: [{ id: "jp", state: "ok" }, { id: "sg", state: "ok" }], notices: [], reach: [
      { region: "jp", checked_at: "2026-11-08T04:20:00Z", sites: { mvdis: "blocked", bot: "challenge", signal: "ok" } },
      { region: "sg", checked_at: "2026-11-08T04:25:00Z", sites: { mvdis: "ok", bot: "ok", signal: "ok" } },
    ], reach_history: { hours: 24, until: "2026-11-08T05:30:00Z", sites: {
      mvdis: { jp: Array.from({ length: 24 }, (_, i) => (i === 5 ? null : "blocked")), sg: Array(24).fill("ok") },
      bot: { jp: Array(24).fill("challenge"), sg: Array(24).fill("ok") },
    } } } });
    if (path === "/api/blocklist/lists") return route.fulfill({ json: { lists: [{ id: "malware", domains: 195355, only_here: 124030 }, { id: "tw165", domains: 86162, only_here: 85915 }, { id: "twmoda", domains: 1732, only_here: 1527 }, { id: "stalkerware", domains: 929, only_here: 902 }, { id: "cti", domains: 381000, only_here: 378000 }, { id: "ads", domains: 219318, only_here: 149687 }], malware_filter: 283040, ads_filter: 432727, hagezi: 345044, as_of: "2026-11-07T04:00:00+00:00" } });
    if (path === "/api/passkeys") return route.fulfill({ json: [] });
    if (path === "/api/invites") return route.fulfill({ json: { per_account: 2, used: 1, left: 0, reason: null, eligible_on: "2026-10-15", days: 7, open: [{ id: 1, created_at: "2026-11-04T01:00:00Z", expires_at: "2026-11-11T01:00:00Z" }] } });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}

const PAGES: [string, boolean][] = [
  ["/", false], ["/en/", false], ["/faq/", false], ["/learn/", false], ["/dns/", false], ["/dns/lists/", false], ["/check/", false],
  ["/status/", false], ["/feedback/", false], ["/terms/", false], ["/privacy/", false], ["/login/", false],
  ["/redeem/", false], ["/devices/", true], ["/devices/new/", true], ["/account/", true], ["/group/", true],
];

for (const scheme of ["light", "dark"] as const) {
  for (const [path, signedIn] of PAGES) {
    test(`axe finds nothing on ${path}, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await backend(page, signedIn);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      // evaluated through the browser's own tools, so the page's CSP does not apply
      await page.evaluate(axe.source);
      const found = await page.evaluate(async () => {
        const res = await (window as unknown as { axe: typeof axe }).axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
        });
        return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
      });
      expect(found).toEqual([]);
    });
  }
}

// the devices page with an inspection in each of its states: the badges, the lines under the spec sheets and their links
const INSPECTED = [
  { ...DEVICES[0], inspection: "confirming", inspection_days: 7, inspection_ends_at: null, inspection_report_until: null, inspection_confirm_minutes: 30 },
  { ...DEVICES[1], inspection: "active", inspection_days: 7, inspection_ends_at: "2026-11-14T04:00:00Z", inspection_report_until: null },
  { ...DEVICES[0], id: "d-c", name: "tablet", inspection: "ending", inspection_days: 7, inspection_ends_at: "2026-11-09T04:00:00Z", inspection_report_until: null },
  { ...DEVICES[1], id: "d-d", name: "desktop", inspection: "ended", inspection_days: 7, inspection_ends_at: "2026-11-08T04:00:00Z", inspection_report_until: "2026-11-15" },
];

for (const scheme of ["light", "dark"] as const) {
  test(`axe finds nothing on /devices/ with inspections, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await backend(page, true);
    await page.route("**/api/devices", (route) => route.fulfill({ json: INSPECTED }));
    await page.route("**/api/me", (route) => route.fulfill({ json: { ...ME, device_limit: 4 } }));
    await page.goto("/devices/");
    await expect(page.getByTestId("device-inspect")).toHaveCount(4);
    await page.evaluate(axe.source);
    const found = await page.evaluate(async () => {
      const res = await (window as unknown as { axe: typeof axe }).axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
    });
    expect(found).toEqual([]);
    // every link to an inspection says which device it is for, starting with its shown words (WCAG 2.5.3)
    const links = page.locator('a[href^="/devices/inspect/"]');
    await expect(links).toHaveCount(5);
    for (const link of await links.all()) {
      const [shown, name] = [(await link.innerText()).replace(/\s+/g, " ").trim(), (await link.getAttribute("aria-label"))!];
      expect(name.startsWith(shown), `${name} starts with ${shown}`).toBe(true);
    }
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`axe finds nothing in the network measurements and the UDP check on /check/, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    // a browser whose UDP gets through, see check.spec.ts
    await page.addInitScript(() => {
      (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = class {
        onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
        addEventListener() {}
        createDataChannel() { return {}; }
        async createOffer() { return {}; }
        async setLocalDescription() { setTimeout(() => this.onicecandidate?.({ candidate: { type: "srflx", candidate: "" } }), 50); }
        close() {}
      };
    });
    await backend(page, false);
    await page.route("**/api/exit", (route) => route.fulfill({ json: { region: null, ipv6: false } }));
    await page.route("**/api/network", (route) => route.fulfill({ json: { asn: 64500, name: "EXAMPLE", days: 30, tests: [
      { id: "web_connectivity", level: "ok", measurements: 26203, anomaly_pct: 3, confirmed: 407 },
      { id: "signal", level: "most", measurements: 100, anomaly_pct: 99, confirmed: 0 },
      { id: "telegram", level: "some", measurements: 100, anomaly_pct: 30, confirmed: 0 },
      { id: "whatsapp", level: "few", measurements: 3, anomaly_pct: 0, confirmed: 0 },
      { id: "tor", level: "unknown", measurements: 0, anomaly_pct: 0, confirmed: 0 },
    ], stun: "stun.example:443" } }));
    await page.goto("/check/");
    await page.getByRole("button", { name: "開始檢測" }).click();
    await expect(page.getByTestId("check-network").locator("li")).toHaveCount(5);
    await expect(page.getByTestId("check-udp").locator(".badge")).toHaveText("通過");
    await page.evaluate(axe.source);
    const found = await page.evaluate(async () => {
      const res = await (window as unknown as { axe: typeof axe }).axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
    });
    expect(found).toEqual([]);
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`axe finds nothing in the folded parts of /dns/lists/, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await backend(page, false);
    await page.goto("/dns/lists/");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
    await page.evaluate(axe.source);
    const found = await page.evaluate(async () => {
      const res = await (window as unknown as { axe: typeof axe }).axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
    });
    expect(found).toEqual([]);
  });
}

test("the focus ring shows on the footer's dark blue", async ({ page }) => {
  await backend(page, false);
  await page.goto("/faq/");
  const link = page.locator("footer .footer-group a").first();
  await link.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  const [ring, behind] = await link.evaluate((e) => [getComputedStyle(e).outlineColor, getComputedStyle(e.closest("footer")!).backgroundColor]);
  const lum = (c: string) => {
    const [r, g, b] = (c.match(/[\d.]+/g) ?? []).map(Number).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [lum(ring!), lum(behind!)].sort((a, b) => b - a);
  expect((hi! + 0.05) / (lo! + 0.05)).toBeGreaterThanOrEqual(3);
});

for (const scheme of ["light", "dark"] as const) {
  test(`a text field's focus ring stands out from the page at 3:1 or more, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await backend(page, false);
    for (const path of ["/login/", "/redeem/", "/dns/", "/feedback/"]) {
      await page.goto(path);
      const fields = page.locator("main .nb-input");
      expect(await fields.count(), path).toBeGreaterThan(0);
      for (const field of await fields.all()) {
        await field.focus();
        const [style, ring, behind] = await field.evaluate((e) => {
          let p: Element | null = e.parentElement;
          let bg = "rgb(255, 255, 255)";
          for (; p; p = p.parentElement) {
            const c = getComputedStyle(p).backgroundColor;
            if (!/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; }
          }
          const s = getComputedStyle(e);
          return [`${s.outlineStyle} ${s.outlineWidth}`, s.outlineColor, bg];
        });
        expect(style, path).toBe("solid 2px");
        const lum = (c: string) => {
          const [r, g, b] = (c.match(/[\d.]+/g) ?? []).map(Number).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        const [hi, lo] = [lum(ring), lum(behind)].sort((x, y) => y - x);
        expect((hi! + 0.05) / (lo! + 0.05), path).toBeGreaterThanOrEqual(3);
      }
    }
  });
}

test("every stop of the keyboard shows a ring, in sight and not covered", async ({ page }) => {
  test.setTimeout(120_000);
  for (const [path, signedIn] of PAGES) {
    await page.unrouteAll();
    await backend(page, signedIn);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const seen = new Set<string>();
    const bad: string[] = [];
    // around the page once: from the first stop until one comes back
    for (let i = 0; i < 150; i++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null;
        if (!e || e === document.body) return null;
        const s = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
        const inView = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
        // what is on top at its middle: itself, inside it, or something over it (WCAG 2.4.11)
        const at = inView ? document.elementFromPoint(r.left + r.width / 2, Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)) : null;
        const covered = !!at && !e.contains(at) && !at.contains(e);
        const name = `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 24)}"`;
        return { key: `${name}@${Math.round(r.top + scrollY)}`, name, ring, inView, covered };
      });
      if (!stop) continue;
      if (seen.has(stop.key)) break;
      seen.add(stop.key);
      if (!stop.ring || !stop.inView || stop.covered) bad.push(`${stop.name} ring=${stop.ring} inView=${stop.inView} covered=${stop.covered}`);
    }
    expect(seen.size, path).toBeGreaterThan(5);
    expect(bad, path).toEqual([]);
  }
});

test.describe("with the text spacing of WCAG 1.4.12", () => {
  // the spacing goes in as a style sheet, which the page's CSP would block
  test.use({ bypassCSP: true });
  test("nothing is cut off and nothing scrolls sideways", async ({ page }) => {
    test.setTimeout(120_000);
    for (const [path, signedIn] of PAGES) {
      await page.unrouteAll();
      await backend(page, signedIn);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
      await page.addStyleTag({ content: "* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }" });
      const found = await page.evaluate(() => {
        const cut: string[] = [];
        for (const e of document.querySelectorAll<HTMLElement>("body *")) {
          const s = getComputedStyle(e);
          if (!/hidden|clip/.test(`${s.overflowX} ${s.overflowY}`) || !e.textContent?.trim() || e.offsetParent === null) continue;
          // left out: what is hidden on purpose and kept for screen readers (.sr-only, a phone's table heads), 1px boxes
          if (e.clientWidth <= 1 || e.clientHeight <= 1) continue;
          if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) cut.push(`${e.tagName.toLowerCase()}.${e.className} "${e.textContent.trim().slice(0, 24)}"`);
        }
        return { cut, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      expect(found, path).toEqual({ cut: [], sideways: 0 });
    }
  });
});

test("nothing scrolls sideways on a 320px screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const [path, signedIn] of PAGES) {
    await page.unrouteAll();
    await backend(page, signedIn);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0);
  }
});

test("what moves on its own stops: no animation runs forever but the busy and loading marks", async ({ page }) => {
  await backend(page, true);
  for (const path of ["/", "/faq/", "/devices/"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(300);
    const forever = await page.evaluate(() =>
      document.getAnimations()
        .filter((a) => a.effect?.getTiming().iterations === Infinity)
        .map((a) => (a.effect as KeyframeEffect).target as Element)
        .filter((e) => !e.closest(".spin, .sk"))
        .map((e) => `${e.tagName}.${e.getAttribute("class")}`));
    expect(forever, path).toEqual([]);
  }
});

// FIG. 06 is off for now (SHOW_ART in src/pages/faq.tsx)
test.skip("the FAQ's cross-section moves for five seconds, then holds still", async ({ page, isMobile }) => {
  test.skip(isMobile, "the drawing is shown on wide screens only");
  await page.setViewportSize({ width: 1280, height: 900 });
  await backend(page, false);
  await page.goto("/");
  const canvas = page.locator(".faq-art canvas");
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas).toBeVisible();
  const frame = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const early = await frame();
  await page.waitForTimeout(1000);
  expect(await frame()).not.toBe(early);
  await page.waitForTimeout(5000);
  const later = await frame();
  await page.waitForTimeout(1000);
  expect(await frame()).toBe(later);
});

// The device inspection (/devices/inspect/) in each of its states. Its parts come and go with the status, so the page
// is checked once per state: what the checks above do for a page, and what only this page has.

const INSPECT_BASE = { consent_version: "2026-11-10b", days: 7, report_days: 7 };
const ENDED = { ...INSPECT_BASE, status: "ended", report_until: "2026-11-18", started_at: "2026-11-09T00:00:00Z", ends_at: "2026-11-11T00:00:00Z" };
const LINK = "https://confirm.vessel.anoni.net/c/ABCDEFGHJKLMNPQR";
type InspectState = { inspection: object | "hang" | "error"; kept?: object; ready: string; act?: (page: Page) => Promise<void> };
const INSPECT: Record<string, InspectState> = {
  loading: { inspection: "hang", ready: 'main [aria-busy="true"]' },
  "could not load": { inspection: "error", ready: '[role="alert"]' },
  consent: { inspection: { ...INSPECT_BASE, status: "none" }, ready: '[data-testid="inspect-consent"]' },
  waiting: { inspection: { ...INSPECT_BASE, status: "confirming", confirm_seconds: 1800 }, kept: { key: KEY, url: LINK, minutes: 30 }, ready: '[data-testid="inspect-url"]' },
  "link about to run out": { inspection: { ...INSPECT_BASE, status: "confirming", confirm_seconds: 200 }, kept: { key: KEY, url: LINK, minutes: 30 }, ready: '[data-testid="inspect-soon"]' },
  "link not here": { inspection: { ...INSPECT_BASE, status: "confirming", confirm_seconds: 1800 }, ready: '[data-testid="inspect-lost"]' },
  running: { inspection: { ...INSPECT_BASE, status: "active", report: seal(FULL_REPORT), ends_at: "2026-11-16T00:00:00Z" }, kept: { key: KEY }, ready: '[data-testid="inspect-report"]' },
  ending: { inspection: { ...INSPECT_BASE, status: "ending" }, ready: "main .card--tint" },
  report: { inspection: { ...ENDED, report: seal(FULL_REPORT) }, kept: { key: KEY }, ready: '[data-testid="inspect-report"]' },
  "report with nothing found": { inspection: { ...ENDED, report: seal({ ...FULL_REPORT, findings: [], more: {} }) }, kept: { key: KEY }, ready: '[data-testid="inspect-verdict"][data-state="clean"]' },
  // reports that say when each site was seen: drawn by day, with an hour that sent more than it received
  "report, sites seen once": { inspection: { ...ENDED, report: seal(ONCE_REPORT) }, kept: { key: KEY }, ready: '[data-testid="inspect-hits"]' },
  // each site with the other lists it is on, and the reason's sentence when all of them are on the ad list too
  "report, sites on other lists": { inspection: { ...ENDED, report: seal(ONCE_LISTS_REPORT) }, kept: { key: KEY }, ready: '[data-testid="inspect-hit-lists"]' },
  "report, every site on the ad list too": { inspection: { ...ENDED, report: seal(ONCE_ADS_REPORT) }, kept: { key: KEY }, ready: '[data-testid="inspect-hit-lists"]' },
  // the notes on sites, with their sources and the line on who wrote them up
  "report, sites with notes": { inspection: { ...ENDED, report: seal(NOTES_REPORT) }, kept: { key: KEY }, ready: '[data-testid="inspect-notes-by"]' },
  "report, stalkerware over days": {
    inspection: { ...ENDED, started_at: WEEK_START, ends_at: "2026-11-08T02:00:00Z", report: seal(THREAT_REPORT) }, kept: { key: KEY }, ready: '[data-testid="inspect-hits"]',
  },
  "report, stalkerware with its app": {
    inspection: { ...ENDED, started_at: WEEK_START, ends_at: "2026-11-08T02:00:00Z", report: seal(THREAT_APP_REPORT) }, kept: { key: KEY }, ready: '[data-testid="inspect-app-source"]',
  },
  "nothing recorded": { inspection: { ...ENDED, report: seal({ empty: true }) }, kept: { key: KEY }, ready: '[data-testid="inspect-empty"]' },
  "asking for the key": {
    inspection: { ...ENDED, report: seal(FULL_REPORT) }, ready: '[data-testid="inspect-locked"]',
    act: async (page) => {
      await page.getByTestId("inspect-key-input").fill("not a key");
      await page.getByTestId("inspect-key-input").press("Enter");
      await page.getByRole("alert").waitFor();
    },
  },
};

async function openInspection(page: Page, state: InspectState) {
  await backend(page, true);
  await page.route("**/api/devices/*/inspection", (route) => {
    if (state.inspection === "hang") return;
    if (state.inspection === "error") return route.fulfill({ status: 503, json: { error: "inspection_unavailable" } });
    return route.fulfill({ json: state.inspection });
  });
  // set or cleared every time: scripts added earlier on the same page still run, before this one
  await page.addInitScript((k) => {
    if (k) localStorage.setItem("vessel-inspection:d-a", JSON.stringify(k));
    else localStorage.removeItem("vessel-inspection:d-a");
  }, state.kept ?? null);
  await page.goto("/devices/inspect/?d=d-a");
  await page.locator(state.ready).first().waitFor();
  await state.act?.(page);
  // the folded parts too: the lists of sites, the table of hours
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
}

for (const scheme of ["light", "dark"] as const) {
  for (const [name, state] of Object.entries(INSPECT)) {
    test(`axe finds nothing on the inspection, ${name}, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openInspection(page, state);
      await page.evaluate(axe.source);
      const found = await page.evaluate(async () => {
        const res = await (window as unknown as { axe: typeof axe }).axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
        });
        return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
      });
      expect(found).toEqual([]);
    });
  }

  // axe leaves out what is hidden from screen readers, as the hours are: the signs on them are still read by eye
  test(`the signs on the hours stand out from their colour at 4.5:1, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const marks: { mark: string | null; ratio: number }[] = [];
    for (const state of [INSPECT.report!, INSPECT["report, sites seen once"]!]) {
      await page.unrouteAll();
      await page.goto("about:blank");
      await openInspection(page, state);
      marks.push(...await page.locator(".tile:not(:empty)").evaluateAll((tiles) => tiles.map((e) => {
        const lum = (c: string) => {
          const [r, g, b] = (c.match(/[\d.]+/g) ?? []).map(Number).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        const s = getComputedStyle(e);
        const [hi, lo] = [lum(s.color), lum(s.backgroundColor)].sort((a, b) => b - a);
        return { mark: e.textContent, ratio: Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100 };
      })));
    }
    expect(marks.length).toBeGreaterThan(2);
    // the arrow of an hour that sent more than it received, on the light steps and the dark ones
    expect(marks.filter((m) => m.mark === "↑").length).toBeGreaterThan(1);
    for (const m of marks) expect(m.ratio, m.mark!).toBeGreaterThanOrEqual(4.5);
  });
}

test("on the inspection, every stop of the keyboard shows a ring, in sight and not covered", async ({ page }) => {
  test.setTimeout(120_000);
  for (const [name, state] of Object.entries(INSPECT)) {
    if (state.inspection === "hang") continue;
    await page.unrouteAll();
    await page.goto("about:blank");
    await openInspection(page, state);
    await page.locator("body").focus();
    const seen = new Set<string>();
    const bad: string[] = [];
    for (let i = 0; i < 150; i++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null;
        if (!e || e === document.body) return null;
        const s = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
        const inView = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
        const at = inView ? document.elementFromPoint(r.left + r.width / 2, Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)) : null;
        const covered = !!at && !e.contains(at) && !at.contains(e);
        const name = `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 24)}"`;
        return { key: `${name}@${Math.round(r.top + scrollY)}`, name, ring, inView, covered };
      });
      if (!stop) continue;
      if (seen.has(stop.key)) break;
      seen.add(stop.key);
      if (!stop.ring || !stop.inView || stop.covered) bad.push(`${stop.name} ring=${stop.ring} inView=${stop.inView} covered=${stop.covered}`);
    }
    expect(seen.size, name).toBeGreaterThan(3);
    expect(bad, name).toEqual([]);
  }
});

test.describe("the inspection with the text spacing of WCAG 1.4.12, and on a 320px screen", () => {
  test.use({ bypassCSP: true });
  test("nothing is cut off and nothing scrolls sideways", async ({ page }) => {
    test.setTimeout(120_000);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 640 });
      for (const [name, state] of Object.entries(INSPECT)) {
        if (state.inspection === "hang") continue;
        await page.unrouteAll();
        await page.goto("about:blank");
        await openInspection(page, state);
        await page.addStyleTag({ content: "* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }" });
        const found = await page.evaluate(() => {
          const cut: string[] = [];
          for (const e of document.querySelectorAll<HTMLElement>("main *")) {
            const s = getComputedStyle(e);
            if (!/hidden|clip/.test(`${s.overflowX} ${s.overflowY}`) || !e.textContent?.trim() || e.offsetParent === null) continue;
            if (e.clientWidth <= 1 || e.clientHeight <= 1) continue;
            if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) cut.push(`${e.tagName.toLowerCase()}.${e.className}`);
          }
          return { cut, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        expect(found, `${name} at ${width}px`).toEqual({ cut: [], sideways: 0 });
      }
    }
  });
});

// WCAG 2.2.2: the link is good for half an hour and the report takes minutes, with buttons beside them; nothing turns
// all that time
test("nothing moves on its own while the inspection waits", async ({ page }) => {
  for (const name of ["waiting", "link about to run out", "ending"]) {
    await page.unrouteAll();
    await page.goto("about:blank");
    await openInspection(page, INSPECT[name]!);
    const forever = await page.evaluate(() =>
      document.getAnimations().filter((a) => a.effect?.getTiming().iterations === Infinity).map((a) => ((a.effect as KeyframeEffect).target as Element).className));
    expect(forever, name).toEqual([]);
  }
});

// axe does not read text drawn by CSS: the NOTE on a warning, the DEVICE on the device under inspection, the + and − of
// the FAQ, the numbers of a to-do list, the column names a table shows as cards on a phone. At their size they need
// 4.5:1 against what they are written on, as any other small text (WCAG 1.4.3). Every page and every state of the
// inspection, on a phone too, where the column names appear.
for (const scheme of ["light", "dark"] as const) {
  test(`the text drawn by CSS stands out at 4.5:1, ${scheme}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: scheme });
    const opens: [string, () => Promise<void>][] = [
      ...PAGES.map(([path, signedIn]) => [path, async () => {
        await backend(page, signedIn);
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
      }] as [string, () => Promise<void>]),
      ...Object.entries(INSPECT).filter(([, state]) => state.inspection !== "hang")
        .map(([name, state]) => [`inspection, ${name}`, () => openInspection(page, state)] as [string, () => Promise<void>]),
    ];
    const seen = new Set<string>();
    const low: string[] = [];
    for (const [name, open] of opens) {
      await page.unrouteAll();
      await page.goto("about:blank");
      await open();
      const labels = await page.evaluate(() => {
        const parse = (c: string) => { const m = (c.match(/[\d.]+/g) ?? []).map(Number); return { rgb: m.slice(0, 3), a: m[3] ?? 1 }; };
        const lum = (rgb: number[]) => {
          const [r, g, b] = rgb.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        // what the content writes: a string, an attribute, or a counter's number (its value is not readable here)
        const words = (e: Element, content: string) => {
          if (content === "none" || content === "normal") return "";
          const quoted = content.match(/^"([^"]*)"/);
          if (quoted) return quoted[1]!.trim();
          const attr = content.match(/^attr\(([\w-]+)\)/);
          if (attr) return (e.getAttribute(attr[1]!) ?? "").trim() && `attr(${attr[1]})`;
          return /^counters?\(/.test(content) ? "counter" : "";
        };
        const out: { text: string; where: string; ratio: number; need: number }[] = [];
        for (const e of document.querySelectorAll("body *")) {
          if (!e.getClientRects().length) continue;
          for (const which of ["::before", "::after"]) {
            const s = getComputedStyle(e, which);
            const text = words(e, s.content);
            if (!text || s.display === "none" || s.visibility === "hidden") continue;
            // the text's own paper, or what is behind its box
            let bg = parse(s.backgroundColor);
            for (let p: Element | null = e; bg.a < 1 && p; p = p.parentElement) bg = parse(getComputedStyle(p).backgroundColor);
            const [hi, lo] = [lum(parse(s.color).rgb), lum(bg.a < 1 ? [255, 255, 255] : bg.rgb)].sort((x, y) => y - x);
            const size = parseFloat(s.fontSize);
            const need = size >= 24 || (parseInt(s.fontWeight) >= 700 && size >= 18.66) ? 3 : 4.5;
            const where = `${e.tagName.toLowerCase()}.${[...e.classList].join(".")}${which}`;
            out.push({ text, where, ratio: Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100, need });
          }
        }
        return out;
      });
      for (const l of labels) {
        seen.add(l.text);
        if (l.ratio < l.need) low.push(`${name}: ${l.where} "${l.text}" ${l.ratio}:1`);
      }
    }
    // the check finds what it is meant to, at any width: the folded parts are open, so the FAQ shows its −
    expect([...seen]).toEqual(expect.arrayContaining(["NOTE", "DEVICE", "−", "counter"]));
    expect([...new Set(low)]).toEqual([]);
  });
}

// A table laid out as blocks on a phone keeps its meaning only through its roles: WebKit has dropped a table's
// semantics once its display changes. Every part of such a table says what it is (WCAG 1.3.1).
test("a table laid out as blocks on a phone says what each part is", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const found: string[] = [];
  let tables = 0;
  for (const path of ["/privacy/", "/terms/", "/dns/lists/"]) {
    await page.unrouteAll();
    await backend(page, false);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
    const result = await page.evaluate(() => {
      const want: Record<string, string[]> = { TABLE: ["table"], THEAD: ["rowgroup"], TBODY: ["rowgroup"], TFOOT: ["rowgroup"], TR: ["row"],
        TH: ["columnheader", "rowheader"], TD: ["cell"] };
      const missing: string[] = [];
      let n = 0;
      for (const table of document.querySelectorAll("main table")) {
        if (getComputedStyle(table).display === "table") continue;
        n++;
        for (const e of [table, ...table.querySelectorAll("thead, tbody, tfoot, tr, th, td")]) {
          if (!want[e.tagName]!.includes(e.getAttribute("role") ?? "")) missing.push(`${table.getAttribute("data-testid") ?? table.className} ${e.tagName.toLowerCase()}`);
        }
      }
      return { n, missing };
    });
    tables += result.n;
    found.push(...result.missing.map((m) => `${path}: ${m}`));
  }
  // the privacy policy's table and the lists page's ones
  expect(tables).toBeGreaterThanOrEqual(4);
  expect([...new Set(found)]).toEqual([]);
});

// Words a stylesheet adds over a cell (its column's name) or beside a summary (+, −) are for the eye: the cell has its
// column header and the summary says whether it is open, so a screen reader would say them twice (VoiceOver on iPhone
// did, 2026-11-11). Each one gives an empty alternative, `content: … / ""`.
test("words a stylesheet adds are not read out a second time", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const loud: string[] = [];
  let seen = 0;
  for (const path of ["/privacy/", "/dns/lists/", "/faq/"]) {
    await page.unrouteAll();
    await backend(page, false);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const result = await page.evaluate(() => {
      const out: string[] = [];
      let n = 0;
      for (const e of document.querySelectorAll("main *")) {
        for (const pseudo of ["::before", "::after"]) {
          const content = getComputedStyle(e, pseudo).content;
          // nothing drawn, or only shapes and lines (an empty string)
          if (!content || content === "none" || content === "normal" || content === '""') continue;
          n++;
          if (!/\/\s*""$/.test(content)) out.push(`${e.tagName.toLowerCase()}.${[...e.classList].join(".")}${pseudo} ${content}`);
        }
      }
      return { n, out };
    });
    seen += result.n;
    loud.push(...result.out.map((m) => `${path}: ${m}`));
  }
  // the cells' column names and the questions' + signs, so the check is not passing on an empty page
  expect(seen).toBeGreaterThan(10);
  expect([...new Set(loud)]).toEqual([]);
});
