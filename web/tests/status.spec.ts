import { type Page, expect, test } from "@playwright/test";

async function status(page: Page, body: unknown, code = 200) {
  await page.route("**/api/status", (route) => route.fulfill({ status: code, json: body }));
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
}

test("nodes and notices", async ({ page }) => {
  await status(page, {
    regions: [{ id: "jp", state: "down" }, { id: "sg", state: "ok" }],
    notices: [
      { region: "jp", kind: "outage", starts_at: "2026-10-29T03:00:00Z", ends_at: null },
      { region: null, kind: "restart", starts_at: "2026-10-28T04:52:00Z", ends_at: "2026-10-28T04:54:00Z" },
    ],
  });
  await page.goto("/status/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("服務狀態");
  const regions = page.getByTestId("status-regions").locator("li");
  await expect(regions).toHaveText([/東京\s*無法連線/, /新加坡\s*正常/]);
  const notices = page.getByTestId("status-notices").locator("li");
  await expect(notices).toHaveCount(2);
  await expect(notices.nth(0)).toContainText("連線中斷 · 東京");
  await expect(notices.nth(0)).toContainText("進行中");
  await expect(notices.nth(0)).toContainText("起");
  await expect(notices.nth(1)).toContainText("節點重新啟動 · 所有城市");
  await expect(notices.nth(1)).toContainText("至");
  await expect(notices.nth(1)).toContainText("連線中斷幾秒，App 會自動重新連上。");
  await expect(page.getByTestId("status-updated")).toContainText("更新於");
  await page.getByRole("link", { name: "回報問題或給建議" }).click();
  await expect(page).toHaveURL(/\/feedback\/\?from=status$/);
});

test("no notices, and a worker nobody heard from", async ({ page }) => {
  await status(page, { regions: [{ id: "sg", state: "unknown" }], notices: [] });
  await page.goto("/status/");
  await expect(page.getByTestId("status-regions").locator("li")).toHaveText([/新加坡\s*無法確認/]);
  await expect(page.getByTestId("status-none")).toHaveText("最近 30 天沒有維護或中斷的紀錄。");
});

test("a failed load says so", async ({ page }) => {
  await status(page, { error: "unknown" }, 502);
  await page.goto("/status/");
  await expect(page.getByRole("alert")).toHaveText("無法取得狀態，請稍後再試。");
});

test("linked from the footer and the feedback page, in three languages", async ({ page }) => {
  await status(page, { regions: [{ id: "sg", state: "ok" }], notices: [] });
  await page.goto("/feedback/");
  await page.locator("main").getByRole("link", { name: "服務狀態" }).click();
  await expect(page).toHaveURL(/\/status\/$/);
  await page.goto("/en/");
  await page.locator("footer").getByRole("link", { name: "Service status" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Service status");
  await expect(page.getByTestId("status-regions").locator("li")).toHaveText([/Singapore\s*Working/]);
  await page.goto("/zh-cn/status/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("服务状态");
});
