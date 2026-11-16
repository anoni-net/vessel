import { type Page, expect, test } from "@playwright/test";

// The signed-in pages line up on a screen with classic scrollbars: a short page (an empty inbox) keeps the scrollbar's
// room like a long one (styles.css, html overflow-y), so its column does not sit 7.5px off when switching tabs.
// Playwright hides scrollbars by default; this file shows them, as a desktop browser does.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const ME = { created_on: "2026-10-01", last_login_on: "2026-11-16", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 1e9,
  inbox: { unread: 0, notes: [] } };
const device = (id: string, name: string) => ({ id, name, region: "sg", dns_filter: "malware", status: "active",
  created_on: "2026-11-01", expires_on: "2026-12-16", used_bytes: 1e8, blocked: 0, blocked_ads: 0, connected: true });

async function backend(page: Page) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: ME });
    if (path === "/api/devices") return route.fulfill({ json: [device("d1", "手機"), device("d2", "筆電")] });
    if (path === "/api/inbox") return route.fulfill({ json: { messages: [], notes: [] } });
    if (path === "/api/passkeys") return route.fulfill({ json: [] });
    if (path === "/api/usage/months") return route.fulfill({ json: { filter: "malware", months: [] } });
    if (path === "/api/invites") {
      return route.fulfill({ json: { per_account: 0, used: 0, left: 0, reason: "off", eligible_on: "2026-10-15", days: 7, open: [] } });
    }
    return route.fulfill({ json: [] });
  });
}

for (const width of [1000, 1440]) {
  test(`at ${width}px a short inbox lines up with the devices and the account`, async ({ page, isMobile }) => {
    test.skip(isMobile, "a phone's scrollbars take no room");
    await page.setViewportSize({ width, height: 1400 });
    await backend(page);
    const boxes = [];
    for (const path of ["/devices/", "/account/", "/inbox/"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      boxes.push(await page.locator(".account-bar").boundingBox());
    }
    const [devices, account, inbox] = boxes.map((b) => b!);
    // the empty inbox is shorter than the window
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    expect(inbox).toEqual(devices);
    expect(account).toEqual(devices);
  });
}
