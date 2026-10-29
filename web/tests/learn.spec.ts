import { expect, test } from "@playwright/test";

test("the VPN basics, linked from the home page and the first step of a new device", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
  await page.goto("/");
  await page.locator(".hero").getByRole("link", { name: "第一次用 VPN？看看 VPN 入門" }).click();
  await expect(page).toHaveURL(/\/learn\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("VPN 入門");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "VPN 在做的事", "日常使用", "確認有沒有連上", "出國前的準備", "連不上的時候", "被認出是 VPN 的可能", "Vessel 經手的資料",
  ]);
  await expect(page.locator("main ol").first().locator("li")).toHaveCount(5);
  await expect(page.getByRole("link", { name: "Tor Browser" })).toHaveAttribute("href", "https://www.torproject.org/");
  await page.getByRole("link", { name: "連線檢測" }).first().click();
  await expect(page).toHaveURL(/\/check\/$/);
  await page.goto("/en/learn/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("VPN basics");
  await page.goto("/zh-cn/learn/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("VPN 入门");
});
