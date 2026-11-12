import { type Page, type Route, expect, test } from "@playwright/test";

// The keys this browser keeps for inspection reports (src/kept-keys.ts) go when the person signs out, deletes the
// account or deletes the device, and stay when the session only ran out.

const ME = { created_on: "2026-10-27", last_login_on: "2026-10-27", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 4.2e9 };
const DEVICES = [
  { id: "d-aaa", name: "phone", region: "sg", dns_filter: "ads", status: "active", created_on: "2026-10-27", expires_on: "2026-11-26", used_bytes: 3.1e9, blocked: 12, connected: true },
  { id: "d-bbb", name: "laptop", region: "sg", dns_filter: "none", status: "active", created_on: "2026-10-27", expires_on: "2026-11-26", used_bytes: 1.1e9, blocked: 0, connected: true },
];
const KEY = "A".repeat(43) + "=";
const REPORT = "這個瀏覽器保存著檢測報告的鑰匙，登出時會一起清除。之後要打開報告，需要開始檢測時保存的報告鑰匙。確定要登出嗎？";

type Handler = (route: Route) => Promise<void> | void;
const json = (body: unknown, status = 200): Handler => (route) => route.fulfill({ status, json: body });

async function mockApi(page: Page, handlers: Record<string, Handler>) {
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const handler = handlers[`${req.method()} ${new URL(req.url()).pathname}`];
    return handler ? handler(route) : route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}

const base = { "GET /api/me": json(ME), "GET /api/devices": json(DEVICES), "GET /api/passkeys": json([]), "POST /api/logout": json({ ok: true }) };

/** Put keys in this browser before the app starts, once: a reload keeps what the app left. */
async function hold(page: Page, slots: Record<string, string>) {
  await page.goto("/404.html");
  await page.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, slots);
}

const slots = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("vessel-inspection:") || k === "vessel-leader-key").sort());

test("signing out says the report key goes, and clears it", async ({ page }) => {
  await mockApi(page, base);
  await hold(page, { "vessel-inspection:d-aaa": JSON.stringify({ key: KEY }) });
  await page.goto("/account/");
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); return d.accept(); });
  await page.getByRole("button", { name: "登出" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  expect(asked).toBe(REPORT);
  expect(await slots(page)).toEqual([]);
});

test("saying no stays signed in and keeps the key", async ({ page }) => {
  let signedOut = false;
  await mockApi(page, { ...base, "POST /api/logout": (route) => { signedOut = true; return route.fulfill({ json: { ok: true } }); } });
  await hold(page, { "vessel-inspection:d-aaa": JSON.stringify({ key: KEY }) });
  await page.goto("/account/");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page).toHaveURL(/\/account\/$/);
  await expect(page.getByRole("button", { name: "登出" })).toBeEnabled();
  expect(signedOut).toBe(false);
  expect(await slots(page)).toEqual(["vessel-inspection:d-aaa"]);
});

test("a leader is told about the results key, and both when both are held", async ({ page }) => {
  await mockApi(page, base);
  for (const [held, said] of [
    [{ "vessel-leader-key": KEY }, "這個瀏覽器保存著你的結果鑰匙，登出時會一起清除。之後要打開成員的檢測結果，需要先前保存的結果鑰匙。確定要登出嗎？"],
    [{ "vessel-leader-key": KEY, "vessel-inspection:d-aaa": JSON.stringify({ key: KEY }) },
      "這個瀏覽器保存著檢測報告的鑰匙與你的結果鑰匙，登出時會一起清除。之後要打開報告或成員的檢測結果，需要先前保存的鑰匙。確定要登出嗎？"],
  ] as const) {
    await hold(page, held);
    await page.goto("/account/");
    let asked = "";
    page.once("dialog", (d) => { asked = d.message(); return d.accept(); });
    await page.getByRole("button", { name: "登出" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    expect(asked).toBe(said);
    expect(await slots(page)).toEqual([]);
  }
});

test("with no key held, signing out asks nothing", async ({ page }) => {
  await mockApi(page, base);
  await page.goto("/account/");
  let asked = false;
  page.on("dialog", (d) => { asked = true; return d.accept(); });
  await page.getByRole("button", { name: "登出" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  expect(asked).toBe(false);
});

test("a sign-out the server did not take keeps the keys", async ({ page }) => {
  await mockApi(page, { ...base, "POST /api/logout": json({ error: "unknown" }, 500) });
  await hold(page, { "vessel-inspection:d-aaa": JSON.stringify({ key: KEY }) });
  await page.goto("/account/");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page.getByRole("alert")).toContainText("登出沒有完成");
  expect(await slots(page)).toEqual(["vessel-inspection:d-aaa"]);
});

test("a session that ran out keeps the keys for the next sign-in", async ({ page }) => {
  await mockApi(page, { "GET /api/me": json({ error: "signed_out" }, 401), "GET /api/devices": json({ error: "signed_out" }, 401) });
  await hold(page, { "vessel-inspection:d-aaa": JSON.stringify({ key: KEY }), "vessel-leader-key": KEY });
  await page.goto("/devices/");
  await expect(page).toHaveURL(/\/login\/$/);
  expect(await slots(page)).toEqual(["vessel-inspection:d-aaa", "vessel-leader-key"]);
});

test("deleting a device clears its key and leaves the other device's", async ({ page }) => {
  let left = DEVICES;
  await mockApi(page, {
    ...base, "GET /api/devices": (route) => route.fulfill({ json: left }),
    "DELETE /api/devices/d-aaa": (route) => { left = DEVICES.slice(1); return route.fulfill({ json: { ok: true } }); },
  });
  await hold(page, { "vessel-inspection:d-aaa": JSON.stringify({ key: KEY }), "vessel-inspection:d-bbb": JSON.stringify({ key: KEY }) });
  await page.goto("/devices/");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /刪除/ }).first().click();
  await expect.poll(() => slots(page)).toEqual(["vessel-inspection:d-bbb"]);
});

test("the key of a device the account no longer has goes when the list loads", async ({ page }) => {
  await mockApi(page, base);
  await hold(page, { "vessel-inspection:d-gone": JSON.stringify({ key: KEY }), "vessel-inspection:d-aaa": JSON.stringify({ key: KEY }), "vessel-leader-key": KEY });
  await page.goto("/devices/");
  await expect(page.getByText("phone")).toBeVisible();
  await expect.poll(() => slots(page)).toEqual(["vessel-inspection:d-aaa", "vessel-leader-key"]);
});

test("deleting the account clears every key", async ({ page }) => {
  await mockApi(page, { ...base, "GET /api/usage/months": json({ filter: "none", months: [] }), "DELETE /api/account": json({ ok: true }) });
  await hold(page, { "vessel-inspection:d-aaa": JSON.stringify({ key: KEY }), "vessel-leader-key": KEY });
  await page.goto("/account/");
  await page.getByLabel("我了解，帳號刪除之後無法復原").check();
  await page.getByRole("button", { name: "刪除帳號" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  expect(await slots(page)).toEqual([]);
});
