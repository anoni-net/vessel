import { type Page, expect, test } from "@playwright/test";

const today = new Date().toISOString().slice(0, 10);
const longAgo = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
const ME = { created_on: "2026-10-27", last_login_on: today, device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 0, usage_as_of: null };
const member = (device_revoked_on: string | null = null) => ({ group: { role: "member", label: "A1", device_revoked_on } });
const VIEW = {
  label: "A1", role: "member", joined_on: "2026-11-01",
  devices: [{ id: "d-1", name: "手機", region: "jp", dns_filter: "malware", status: "active", expires_on: "2030-01-01", issues: ["blocked_many"] }],
};

async function backend(page: Page, me: object) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: { ...ME, ...me } });
    if (path === "/api/group/mine") return route.fulfill({ json: VIEW });
    if (path === "/api/invites") return route.fulfill({ json: { reason: "off", open: [] } });
    if (path === "/api/usage/months") return route.fulfill({ json: { months: [], strongest: null } });
    if (path === "/api/regions") return route.fulfill({ json: [{ id: "sg", open: true }] });
    return route.fulfill({ json: [] });
  });
}

test("the account page shows a member what the leaders see, and what to do", async ({ page }) => {
  await backend(page, member());
  await page.goto("/account/");
  const view = page.getByTestId("group-view");
  await expect(view).toContainText("團體負責人看得到的內容");
  await expect(view).toContainText("A1");
  await expect(view).toContainText("手機");
  await expect(view).toContainText("擋下的惡意網站偏多");
  await expect(view).toContainText("不代表裝置一定有問題");
  await expect(page.getByTestId("group-view-revoked")).toHaveCount(0);
});

test("the account page says when a leader last revoked a device", async ({ page }) => {
  await backend(page, member(longAgo));
  await page.goto("/account/");
  await expect(page.getByTestId("group-view-revoked")).toBeVisible();
});

test("a personal account has none of this", async ({ page }) => {
  await backend(page, { group: null });
  await page.goto("/account/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("group-view")).toHaveCount(0);
});

test("a device revoked lately is explained on the devices page, for a while", async ({ page }) => {
  await backend(page, member(today));
  await page.goto("/devices/");
  await expect(page.getByTestId("revoked-note")).toContainText("撤銷了你的一台裝置");
  await page.unroute("**/api/**");
  await backend(page, member(longAgo));
  await page.goto("/devices/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("revoked-note")).toHaveCount(0);
});

for (const [name, me, words] of [
  ["a member", member(), "負責人看得到這個名稱"],
  ["a person", { group: null }, "只有你看得到"],
] as const) {
  test(`the name step tells ${name} who can see the name`, async ({ page }) => {
    await backend(page, me);
    await page.goto("/devices/new/");
    await page.getByRole("button", { name: "已經安裝，下一步" }).click();
    await page.getByRole("button", { name: /新加坡/ }).click();
    await expect(page.locator("#name-hint")).toContainText(words);
  });
}
