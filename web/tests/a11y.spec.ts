import { type Page, expect, test } from "@playwright/test";
import axe from "axe-core";

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

async function backend(page: Page, signedIn: boolean) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return signedIn ? route.fulfill({ json: ME }) : route.fulfill({ status: 401, json: { error: "signed_out" } });
    if (path === "/api/devices") return route.fulfill({ json: DEVICES });
    if (path === "/api/regions") return route.fulfill({ json: [{ id: "jp", open: true }, { id: "sg", open: true }] });
    if (path === "/api/status") return route.fulfill({ json: { regions: [{ id: "jp", state: "ok" }, { id: "sg", state: "ok" }], notices: [] } });
    if (path === "/api/passkeys") return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}

const PAGES: [string, boolean][] = [
  ["/", false], ["/en/", false], ["/faq/", false], ["/learn/", false], ["/dns/", false], ["/check/", false],
  ["/status/", false], ["/feedback/", false], ["/terms/", false], ["/privacy/", false], ["/login/", false],
  ["/redeem/", false], ["/devices/", true], ["/devices/new/", true], ["/account/", true],
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

test("the FAQ's cross-section moves for five seconds, then holds still", async ({ page, isMobile }) => {
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
