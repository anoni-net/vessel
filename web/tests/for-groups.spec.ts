import { expect, test } from "@playwright/test";

test("group accounts: what they are and how to ask, linked from the home page, the questions and the invite pages", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
  await page.route("**/api/pickup", (route) => route.fulfill({ json: { open: false } }));
  await page.goto("/");
  await page.locator("#groups").getByRole("link", { name: "團體帳號與裝置檢測的介紹" }).click();
  await expect(page).toHaveURL(/\/for-groups\/$/);
  // device inspection leads: the heading, and an example of what comes back, seven days of hours and three verdicts
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("團體裝置的流量檢測");
  await expect(page.locator(".gi-tile")).toHaveCount(7 * 24);
  await expect(page.locator(".gi-tile--mark")).toHaveCount(2);
  await expect(page.locator(".gi-verdicts li")).toHaveCount(3);
  await expect(page.locator(".gi-fig figcaption")).toContainText("範例");
  await expect(page.locator("main").getByRole("heading", { level: 2 })).toHaveText([
    "檢測的流程", "臨時與定期的檢測", "成員的報告與負責人的摘要", "團體帳號的其他功能", "申請方式",
  ]);
  await expect(page.locator("#flow ol li")).toHaveCount(4);
  // beside the steps, where the connections go: drawn like the home page's pictures, its labels in the page's language
  await expect(page.locator("#flow figure").getByRole("img")).toHaveAttribute("aria-label", /複製一份到分析主機，封包分析完立刻刪除/);
  await expect(page.locator("#flow .hero-fig__label")).toContainText(["Vessel 節點", "分析主機", "完整的報告", "判斷結果的摘要", "成員的裝置", "負責人"]);
  await expect(page.locator("#plan").getByRole("heading", { level: 3 })).toHaveText(["臨時檢測", "定期檢測"]);
  // who sees what, said once, with the policy one link away
  await expect(page.locator("#results").getByRole("heading", { level: 3 })).toHaveText(["成員的報告", "負責人的摘要"]);
  await expect(page.locator("#results").getByRole("link", { name: "隱私權政策的「團體」一節" })).toHaveAttribute("href", "/privacy/#groups");
  await expect(page.locator("#more dt")).toHaveCount(5);
  // the button under the lead goes to the three steps; asking needs a way to reach the group, which the feedback
  // form has, and it notes where the visitor came from
  await expect(page.getByRole("link", { name: "申請團體帳號" })).toHaveAttribute("href", "#apply");
  await expect(page.locator("#apply ol li")).toHaveCount(3);
  await expect(page.getByRole("link", { name: "前往意見回覆" })).toHaveAttribute("href", "/feedback/?from=groups");
  await expect(page.locator("#apply").getByRole("link", { name: "社群的聯絡方式" })).toHaveAttribute("href", "https://anoni.net/contact/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.goto("/faq/#q-teamApply");
  await expect(page.locator("#q-teamApply")).toHaveAttribute("open", "");
  await expect(page.locator("#q-teamApply a")).toHaveAttribute("href", "/for-groups/");
  await expect(page.locator("#q-teamSees a")).toHaveAttribute("href", "/privacy/#groups");

  for (const path of ["/redeem/", "/pickup/"]) {
    await page.goto(path);
    await expect(page.getByRole("link", { name: "替團體準備 VPN？看看團體帳號" })).toHaveAttribute("href", "/for-groups/");
  }

  await page.goto("/en/for-groups/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Traffic inspection for your group's devices");
  await expect(page.getByRole("link", { name: "Go to feedback" })).toHaveAttribute("href", "/en/feedback/?from=groups");
  await page.goto("/zh-cn/for-groups/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("团体设备的流量检测");
});
