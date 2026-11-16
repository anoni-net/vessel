import { type Page, expect, test } from "@playwright/test";

// The inbox (pages/inbox.tsx): the count beside its tab, the banner of an unread announcement, the page itself, and
// the seen notes this browser keeps until it signs out.

const NOTES = [
  { key: "report:d1:2026-11-23", kind: "report", device: "d1", name: "手機", until: "2026-11-23" },
  { key: "moved:sg:2026-11-30", kind: "moved", region: "sg", names: ["手機", "筆電"], until: "2026-11-30" },
  { key: "invites:2", kind: "invites", left: 2 },
];
const MESSAGES = [
  {
    id: 7, created_at: "2026-11-16T02:00:00Z", expires_on: "2026-12-16", region: "sg", group: false, unread: true,
    texts: { "zh-TW": { title: "新加坡節點維護", body: "11 月 20 日 02:00（UTC）起約 10 分鐘。\n期間會斷線。\n\n結束後自動恢復。" } },
  },
  {
    id: 3, created_at: "2026-11-01T02:00:00Z", expires_on: "2026-12-01", region: null, group: false, unread: true,
    texts: { "zh-TW": { title: "新功能：裝置檢測", body: "可以檢測裝置的流量。" }, en: { title: "New: device inspection", body: "Inspect a device's traffic." } },
  },
];
const ME = { created_on: "2026-10-01", last_login_on: "2026-11-16", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 1e9 };

async function backend(page: Page, opts: { read?: string[] } = {}) {
  let unread = 2;
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const key = `${req.method()} ${new URL(req.url()).pathname}`;
    if (key === "GET /api/me") return route.fulfill({ json: { ...ME, inbox: { unread, notes: NOTES.map((n) => n.key) } } });
    if (key === "GET /api/inbox") {
      return route.fulfill({ json: { messages: MESSAGES.map((m) => ({ ...m, unread: unread > 0 && m.unread })), notes: NOTES } });
    }
    if (key === "POST /api/inbox/read") {
      opts.read?.push(req.headers()["x-vessel-request"]);
      unread = 0;
      return route.fulfill({ json: { unread: 0 } });
    }
    if (key === "POST /api/logout") return route.fulfill({ json: { ok: true } });
    if (key === "GET /api/passkeys") return route.fulfill({ json: [] });
    if (key === "GET /api/usage/months") return route.fulfill({ json: { filter: "malware", months: [] } });
    if (key === "GET /api/invites") return route.fulfill({ json: { per_account: 0, used: 0, left: 0, reason: "off", eligible_on: "2026-10-15", days: 7, open: [] } });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}

test("the tab counts what is new, and the newest unread announcement shows on the signed-in pages", async ({ page }) => {
  await backend(page);
  await page.goto("/account/");
  const tab = page.getByRole("link", { name: /^信箱\s*，5 則新的$/ });
  await expect(tab).toBeVisible();
  await expect(page.getByTestId("inbox-count")).toHaveText("5，5 則新的");
  const banner = page.getByTestId("inbox-banner");
  await expect(banner).toHaveText("新的公告：新加坡節點維護（另外還有 1 則）");
  await banner.getByRole("link").click();
  await expect(page).toHaveURL(/\/inbox\/$/);
});

test("opening the inbox reads it all: the announcements on the server, the notes in this browser", async ({ page }) => {
  const read: string[] = [];
  await backend(page, { read });
  await page.goto("/inbox/");
  await expect(page.getByRole("heading", { level: 1, name: "信箱" })).toBeVisible();

  const notes = page.getByTestId("inbox-note");
  await expect(notes).toHaveCount(3);
  await expect(notes.nth(0)).toContainText("「手機」的檢測報告可以下載了，保存到 2026/11/23。");
  await expect(notes.nth(0).getByRole("link", { name: "打開報告" })).toHaveAttribute("href", "/devices/inspect/?d=d1");
  await expect(notes.nth(1)).toContainText("新加坡節點換了新的主機，「手機」、「筆電」的設定檔 2026/11/30 之後就不能連線");
  await expect(notes.nth(2)).toContainText("你還可以邀請 2 位朋友使用 Vessel。");
  // all new the first time
  await expect(notes.getByText("新的", { exact: true })).toHaveCount(3);

  const messages = page.getByTestId("inbox-message");
  await expect(messages).toHaveCount(2);
  await expect(messages.nth(0)).toContainText("給新加坡節點的使用者");
  await expect(messages.nth(0).getByRole("heading", { name: "新加坡節點維護" })).toBeVisible();
  // a blank line starts a paragraph; a single line break stays inside it
  await expect(messages.nth(0).locator(".inbox-body")).toHaveCount(2);
  await expect(messages.nth(0).locator(".inbox-body").first()).toHaveText("11 月 20 日 02:00（UTC）起約 10 分鐘。\n期間會斷線。");
  await expect(messages.nth(1)).toContainText("給所有使用者");

  expect(read).toEqual(["1"]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("vessel-inbox-seen") ?? "[]"))).toEqual(NOTES.map((n) => n.key));
  // nothing is new on the next page, and no banner
  await page.getByRole("link", { name: "帳號", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "帳號" })).toBeVisible();
  await expect(page.getByTestId("inbox-count")).toHaveCount(0);
  await expect(page.getByTestId("inbox-banner")).toHaveCount(0);
  // and the inbox again: the same items, none marked new
  await page.getByRole("link", { name: "信箱", exact: true }).click();
  await expect(page.getByTestId("inbox-note")).toHaveCount(3);
  await expect(page.getByText("新的", { exact: true })).toHaveCount(0);
});

test("an announcement with no words in the reader's language shows the Traditional Chinese, and says so", async ({ page }) => {
  await backend(page);
  await page.goto("/en/inbox/");
  const messages = page.getByTestId("inbox-message");
  await expect(messages.nth(0).getByRole("heading", { name: "新加坡節點維護" })).toBeVisible();
  await expect(messages.nth(0).locator("[lang]").first()).toHaveAttribute("lang", "zh-Hant-TW");
  await expect(messages.nth(0)).toContainText("This announcement is only in Traditional Chinese.");
  await expect(messages.nth(1).getByRole("heading", { name: "New: device inspection" })).toBeVisible();
  await expect(messages.nth(1)).not.toContainText("only in Traditional Chinese");
});

test("signing out clears the notes this browser has seen", async ({ page }) => {
  await backend(page);
  await page.goto("/inbox/");
  await expect(page.getByTestId("inbox-note")).toHaveCount(3);
  expect(await page.evaluate(() => localStorage.getItem("vessel-inbox-seen"))).not.toBeNull();
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page).toHaveURL(/:\d+\/$/);
  expect(await page.evaluate(() => localStorage.getItem("vessel-inbox-seen"))).toBeNull();
});

test("an older backend without the inbox: no count and no banner", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: ME });
    if (path === "/api/passkeys") return route.fulfill({ json: [] });
    if (path === "/api/usage/months") return route.fulfill({ json: { filter: "malware", months: [] } });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  await page.goto("/account/");
  await expect(page.getByRole("heading", { level: 1, name: "帳號" })).toBeVisible();
  await expect(page.getByRole("link", { name: "信箱", exact: true })).toBeVisible();
  await expect(page.getByTestId("inbox-count")).toHaveCount(0);
  await expect(page.getByTestId("inbox-banner")).toHaveCount(0);
});

test("on a wide screen the inbox is as wide as the account page, the reminders beside the announcements", async ({ page, isMobile }) => {
  test.skip(isMobile, "the phone keeps one column");
  await backend(page);
  await page.goto("/account/");
  await expect(page.getByRole("heading", { level: 1, name: "帳號" })).toBeVisible();
  const account = (await page.locator("main > section").boundingBox())!;
  await page.goto("/inbox/");
  await expect(page.getByTestId("inbox-message")).toHaveCount(2);
  const inbox = (await page.locator("main > section").boundingBox())!;
  expect(Math.round(inbox.width)).toBe(Math.round(account.width));
  const notes = (await page.getByTestId("inbox-notes").boundingBox())!;
  const messages = (await page.getByTestId("inbox-messages").boundingBox())!;
  expect(Math.round(messages.y)).toBe(Math.round(notes.y));
  expect(messages.x).toBeGreaterThan(notes.x + notes.width);
});

test("on a phone the reminders come before the announcements", async ({ page, isMobile }) => {
  test.skip(!isMobile, "only the phone");
  await backend(page);
  await page.goto("/inbox/");
  await expect(page.getByTestId("inbox-message")).toHaveCount(2);
  const notes = (await page.getByTestId("inbox-notes").boundingBox())!;
  const messages = (await page.getByTestId("inbox-messages").boundingBox())!;
  expect(messages.y).toBeGreaterThan(notes.y + notes.height);
  expect(Math.round(messages.x)).toBe(Math.round(notes.x));
});
