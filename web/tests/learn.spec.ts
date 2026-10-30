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
  // Android's always-on and block options, which leave the phone offline when the VPN is down
  await expect(page.getByRole("heading", { level: 3, name: "手機系統的 VPN 選項" })).toBeVisible();
  await expect(page.locator("main ol").nth(1).locator("li")).toHaveCount(6);
  await expect(page.getByRole("link", { name: "Tor Browser" })).toHaveAttribute("href", "https://www.torproject.org/");
  // other anoni.net sites in the same language: the docs explain Tor, the community home lists how to reach us
  await expect(page.getByRole("link", { name: "Tor 與 VPN 的差別" })).toHaveAttribute("href", "https://anoni.net/docs/tools/what-is-tor/");
  await expect(page.getByRole("link", { name: "社群的聯絡方式" })).toHaveAttribute("href", "https://anoni.net/contact/");
  await page.getByRole("link", { name: "連線檢測" }).first().click();
  await expect(page).toHaveURL(/\/check\/$/);
  await page.goto("/en/learn/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("VPN basics");
  await expect(page.getByRole("link", { name: "How Tor differs from a VPN" })).toHaveAttribute("href", "https://anoni.net/docs/en/tools/what-is-tor/");
  await page.goto("/zh-cn/learn/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("VPN 入门");
});
