import { expect, test } from "@playwright/test";

test("group accounts: what they are and how to ask, linked from the home page, the questions and the invite pages", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
  await page.route("**/api/pickup", (route) => route.fulfill({ json: { open: false } }));
  await page.goto("/");
  await page.locator("#groups").getByRole("link", { name: "團體帳號的說明與申請" }).click();
  await expect(page).toHaveURL(/\/for-groups\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("團體帳號");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "適合的團體", "負責人可以做的事", "成員的使用方式", "負責人看得到的內容", "費用與期限", "申請方式",
  ]);
  // what leaders can and cannot see, said once, with the policy one link away
  await expect(page.getByRole("heading", { level: 3 })).toHaveText(["看得到", "看不到"]);
  await expect(page.getByRole("link", { name: "隱私權政策的「團體」一節" })).toHaveAttribute("href", "/privacy/#groups");
  await expect(page.locator("main ol li")).toHaveCount(3);
  // asking needs a way to reach the group, which the feedback form has; it notes where the visitor came from
  await expect(page.getByRole("link", { name: "前往意見回覆" })).toHaveAttribute("href", "/feedback/?from=groups");
  await expect(page.getByRole("link", { name: "社群的聯絡方式" })).toHaveAttribute("href", "https://anoni.net/contact/");

  await page.goto("/faq/#q-teamApply");
  await expect(page.locator("#q-teamApply")).toHaveAttribute("open", "");
  await expect(page.locator("#q-teamApply a")).toHaveAttribute("href", "/for-groups/");
  await expect(page.locator("#q-teamSees a")).toHaveAttribute("href", "/privacy/#groups");

  for (const path of ["/redeem/", "/pickup/"]) {
    await page.goto(path);
    await expect(page.getByRole("link", { name: "替團體準備 VPN？看看團體帳號" })).toHaveAttribute("href", "/for-groups/");
  }

  await page.goto("/en/for-groups/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Group accounts");
  await expect(page.getByRole("link", { name: "Go to feedback" })).toHaveAttribute("href", "/en/feedback/?from=groups");
  await page.goto("/zh-cn/for-groups/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("团体账号");
});
