import { type Page, expect, test } from "@playwright/test";

// The dark scheme follows the system's setting (toomore/anoni-net-ws#456). Every piece of text has to stay readable
// on what is behind it, which a single colour borrowed from the light scheme (the footer's links once were) breaks.

const DEVICE = { id: "d-a", name: "phone", region: "jp", dns_filter: "ads", status: "active", created_on: "2026-10-27",
  expires_on: "2026-11-26", used_bytes: 3.1e9, blocked: 12, connected: true, moved_until: null, ipv6: false };

async function signedIn(page: Page) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: { created_on: "2026-10-27", last_login_on: "2026-10-27", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 4.2e9 } });
    if (path === "/api/devices") return route.fulfill({ json: [DEVICE] });
    if (path === "/api/passkeys") return route.fulfill({ json: [] });
    if (path === "/api/usage/months") return route.fulfill({ json: { filter: "ads", months: [{ month: "2026-11-01", used_bytes: 4.2e9, blocked: 3, blocked_ads: 40 }] } });
    if (path === "/api/status") return route.fulfill({ json: { regions: [{ id: "jp", state: "ok" }, { id: "sg", state: "down" }], notices: [] } });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}

/** Text whose contrast with the first solid background behind it is under `min`, as "contrast: text". */
const lowContrast = (page: Page, min: number) =>
  page.evaluate((min) => {
    const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const behind = (el: Element | null): number[] => {
      for (; el; el = el.parentElement) {
        const c = rgb(getComputedStyle(el).backgroundColor);
        if (c.length === 3 || (c.length === 4 && c[3] > 0.5)) return c.slice(0, 3);
      }
      return [255, 255, 255];
    };
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      const text = n.textContent!.trim();
      if (!text || el.closest("[aria-hidden=true], .sr-only, svg, script, style")) continue;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || getComputedStyle(el).visibility === "hidden" || getComputedStyle(el).opacity === "0") continue;
      const [a, b] = [lum(rgb(getComputedStyle(el).color)), lum(behind(el))];
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < min) out.push(`${ratio.toFixed(2)}: ${text.slice(0, 30)}`);
    }
    return out;
  }, min);

test.use({ colorScheme: "dark", reducedMotion: "reduce" });

for (const path of ["/", "/en/", "/devices/", "/account/", "/faq/", "/dns/", "/feedback/", "/status/", "/check/", "/learn/", "/privacy/"]) {
  test(`dark: the text of ${path} stays readable`, async ({ page }) => {
    await signedIn(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(11, 24, 56)");
    expect(await lowContrast(page, 4.5)).toEqual([]);
  });
}

test("dark: the header shows the logo with light words", async ({ page }) => {
  await page.goto("/");
  const src = await page.locator(".brand__logo").evaluate((img: HTMLImageElement) => img.currentSrc);
  expect(src).toContain("logo-wordmark-tonal-dark-");
});
