import { type Page, expect, test } from "@playwright/test";

// Which of the four test addresses Vessel's resolvers hide decides the verdict; here the browser is told
// a hidden one does not exist, as it would be.
async function resolve(page: Page, hidden: number[]) {
  const asked: number[] = [];
  await page.route(/https:\/\/vessel-dns-(\d)\.anoni\.net\/check/, (route) => {
    const n = Number(/vessel-dns-(\d)/.exec(route.request().url())![1]);
    asked.push(n);
    return hidden.includes(n) ? route.abort("namenotresolved") : route.fulfill({ status: 200, body: "ok\n" });
  });
  return asked;
}

for (const [hidden, text] of [
  [[1, 2, 3], "正在使用 Vessel 的 DNS，會擋下惡意網站與廣告。"],
  [[1, 2], "正在使用 Vessel 的 DNS，會擋下惡意網站。"],
  [[1], "正在使用 Vessel 的 DNS，沒有過濾。"],
  [[], "這個瀏覽器沒有使用 Vessel 的 DNS。"],
  [[0, 1, 2, 3], "連不上測試網址，請確認網路之後再試。"],
  [[1, 3], "結果前後不一致，請等一分鐘再檢查一次。"],
] as const) {
  test(`the check reads hidden ${hidden.join(",") || "none"}`, async ({ page }) => {
    const asked = await resolve(page, [...hidden]);
    await page.goto("/dns/");
    await page.getByRole("button", { name: "開始檢查" }).click();
    await expect(page.getByTestId("dns-check").getByRole("status")).toContainText(text);
    // the control address goes first; when it fails nothing else is asked
    expect(asked[0]).toBe(0);
    if (hidden.includes(0 as never)) expect(asked).toEqual([0]);
  });
}

test("the DNS page in three languages, linked from the home page", async ({ page }) => {
  await page.goto("/");
  await page.locator("#how").getByRole("link", { name: "網域過濾的說明" }).click();
  await expect(page).toHaveURL(/\/dns\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("網域過濾");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["檢查目前的過濾", "三種選項", "運作方式", "做不到的事", "更換與回報"]);
  await page.goto("/en/dns/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("DNS filtering");
  await expect(page.getByRole("link", { name: "HaGeZi's GitHub" })).toHaveAttribute("href", "https://github.com/hagezi/dns-blocklists");
  await page.goto("/zh-cn/dns/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("域名过滤");
});
