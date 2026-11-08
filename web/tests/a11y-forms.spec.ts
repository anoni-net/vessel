import { type Page, type Route, expect, test } from "@playwright/test";

// WCAG 2.2 AA past a page's first look: what is said to screen readers when something is done (4.1.3), errors tied to
// their field and focus taken to them (3.3.1), names that start with what is shown (2.5.3), and a way past the header
// (2.4.1). See a11y.spec.ts for axe and the rest.

const ME = { created_on: "2026-10-27", last_login_on: "2026-10-27", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 0 };
const DEVICES = [
  { id: "d-a", name: "phone", region: "sg", dns_filter: "ads", status: "active", created_on: "2026-10-28", expires_on: "2026-12-04",
    used_bytes: 3e9, blocked: 12, connected: true, ipv6: true, moved_until: null },
  { id: "d-b", name: "laptop", region: "sg", dns_filter: "none", status: "active", created_on: "2026-11-01", expires_on: "2026-12-04",
    used_bytes: 0, blocked: 0, connected: true, ipv6: true, moved_until: null },
];

type Handler = (route: Route) => unknown;
const json = (body: unknown, status = 200): Handler => (route) => route.fulfill({ status, json: body });

async function mockApi(page: Page, handlers: Record<string, Handler>) {
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const handler = handlers[`${req.method()} ${new URL(req.url()).pathname}`];
    return handler ? handler(route) : route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}
const signedOut = { "GET /api/me": json({ error: "signed_out" }, 401) };
const announced = (page: Page) => page.locator("#announce");

test("the first Tab offers a way past the header, which shows when it has focus", async ({ page }) => {
  await mockApi(page, signedOut);
  await page.goto("/faq/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "跳到主要內容" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("main"))).toBe(true);
  // out of sight again once focus has moved on
  await expect(skip).not.toBeInViewport();
});

test("a wrong number is tied to the field", async ({ page }) => {
  await mockApi(page, { ...signedOut, "POST /api/login": json({ error: "invalid_number" }, 401) });
  await page.goto("/login/");
  const field = page.getByLabel("帳號號碼");
  await expect(field).not.toHaveAttribute("aria-invalid");
  await field.fill("0000 0000 0000 0000");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("帳號號碼不正確。");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(/^帳號號碼不正確。/);
  // and the "Show" button says what a press does, without a pressed state on top
  await expect(page.getByRole("button", { name: "顯示" })).not.toHaveAttribute("aria-pressed");
});

test("the saved file's text pasted whole still signs in with the number", async ({ page }) => {
  await mockApi(page, signedOut);
  await page.goto("/login/");
  const field = page.getByLabel("帳號號碼");
  await field.focus();
  await page.keyboard.insertText("Vessel 帳號號碼\n4821 0937 5564 2018\n");
  await expect(field).toHaveValue("4821 0937 5564 2018");
});

test("feedback that is not ready takes focus to the first thing to fix", async ({ page }) => {
  await mockApi(page, signedOut);
  await page.goto("/feedback/");
  await page.getByRole("button", { name: "送出" }).click();
  await expect(page.getByLabel("連不上或常斷線")).toBeFocused();
  await expect(page.getByRole("group", { name: "想告訴我們的是" })).toHaveAccessibleDescription("請選一個類型。");
  await page.getByLabel("連不上或常斷線").check();
  await page.getByLabel("發生了什麼事？").fill("太短");
  await page.getByRole("button", { name: "送出" }).click();
  const message = page.getByLabel("發生了什麼事？");
  await expect(message).toBeFocused();
  await expect(message).toHaveAttribute("aria-invalid", "true");
  await expect(message).toHaveAccessibleDescription(/^請至少寫 10 個字。/);
});

test("a name of only spaces is caught on its own step", async ({ page }) => {
  await mockApi(page, {
    "GET /api/me": json(ME),
    "GET /api/devices": json([]),
    "GET /api/regions": json([{ id: "sg", open: true }]),
    "GET /api/relays": json([]),
  });
  await page.goto("/devices/new/");
  await page.getByRole("button", { name: "已經安裝，下一步" }).click();
  await page.getByRole("button", { name: /新加坡/ }).click();
  // labelled by the heading it sits under, so what is read is what is shown
  const field = page.getByRole("textbox", { name: "替裝置取個名稱" });
  await field.fill("   ");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("替裝置取個名稱");
  await expect(page.getByRole("alert")).toHaveText("請輸入裝置名稱。");
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await field.fill("手機");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("額外的防護");
});

test("each device's delete button names the device, and a done delete is said", async ({ page }) => {
  let deleted = false;
  await mockApi(page, {
    "GET /api/me": json(ME),
    "GET /api/devices": (route) => route.fulfill({ json: deleted ? DEVICES.slice(1) : DEVICES }),
    "DELETE /api/devices/d-a": (route) => { deleted = true; return route.fulfill({ json: { ok: true } }); },
  });
  await page.goto("/devices/");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["phone", "laptop"]);
  const buttons = page.getByTestId("device-list").getByRole("button");
  await expect(buttons).toHaveText(["刪除", "刪除"]);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "刪除「phone」" }).click();
  await expect(page.getByTestId("device-list").getByText("phone")).toHaveCount(0);
  await expect(announced(page)).toHaveText("已刪除「phone」。");
});

test("a failed delete stays on screen above the list", async ({ page }) => {
  await mockApi(page, {
    "GET /api/me": json(ME),
    "GET /api/devices": json(DEVICES),
    "DELETE /api/devices/d-a": json({ error: "node_unreachable" }, 502),
  });
  await page.goto("/devices/");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "刪除「phone」" }).click();
  await expect(page.getByTestId("delete-error")).toBeVisible();
  // the list is still there, and the error is not cleared by the reload after the delete
  await expect(page.getByTestId("device")).toHaveCount(2);
  await page.waitForTimeout(500);
  await expect(page.getByTestId("delete-error")).toBeVisible();
});

test("copying the account number is said", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockApi(page, { ...signedOut, "POST /api/redeem": json({ account_number: "4821093755642018" }) });
  await page.goto("/redeem/");
  await page.getByLabel("邀請碼").fill("abcd-efgh-jkmn-pqrs");
  await page.getByRole("button", { name: "兌換" }).click();
  await page.getByRole("button", { name: "複製" }).click();
  await expect(announced(page)).toHaveText("已複製");
});

test("deleting the account signs out the header and says it is done", async ({ page }) => {
  await mockApi(page, { "GET /api/me": json(ME), "GET /api/devices": json([]), "DELETE /api/account": json({ ok: true }) });
  await page.goto("/account/");
  await page.getByLabel("我了解，帳號刪除之後無法復原").check();
  await page.getByRole("button", { name: "刪除帳號" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(announced(page)).toHaveText("帳號已刪除。");
  await expect(page.locator("header").getByRole("link", { name: "我的裝置" })).toHaveCount(0);
});

test("English words on a Chinese page are marked or kept from screen readers", async ({ page }) => {
  await mockApi(page, signedOut);
  await page.goto("/");
  for (const field of await page.locator(".title-block__field").all()) await expect(field).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("figcaption .eyebrow").first()).toHaveAttribute("lang", "en");
});
