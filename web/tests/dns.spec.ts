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
  [[1, 2, 3], "正在使用 Vessel 的 DNS，會擋下惡意網站、廣告與追蹤。"],
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
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["檢查目前的過濾", "查詢網站有沒有被擋", "三種選項", "運作方式", "做不到的事", "更換與回報"]);
  await page.goto("/en/dns/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("DNS filtering");
  await expect(page.getByRole("link", { name: "HaGeZi's GitHub" })).toHaveAttribute("href", "https://github.com/hagezi/dns-blocklists");
  await page.goto("/zh-cn/dns/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("域名过滤");
});

test("look up whether a site is on the lists, and report one blocked by mistake", async ({ page }) => {
  const asked: unknown[] = [];
  await page.route("**/api/blocklist", async (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    expect(route.request().headers()["x-vessel-request"]).toBe("1");
    if (body.domain === "bad") return route.fulfill({ status: 400, json: { error: "invalid_domain" } });
    const malware = body.domain.includes("phish");
    const ads = malware || body.domain.includes("ads");
    const tw165 = body.domain.includes("scam");
    const twmoda = body.domain.includes("fakeshop");
    return route.fulfill({ json: { domain: body.domain.replace(/^https?:\/\//, "").split("/")[0], malware, tw165, twmoda, ads } });
  });
  await page.goto("/dns/");
  const box = page.getByTestId("dns-lookup");
  await box.getByLabel("網址或網域").fill("good.example");
  await box.getByRole("button", { name: "查詢" }).click();
  await expect(box.getByTestId("lookup-answer")).toHaveText("good.example 不在 Vessel 的名單上，打不開的原因可能在網站本身或目前的網路。");
  await expect(box.getByRole("link", { name: /回報給我們/ })).toHaveCount(0);

  await box.getByLabel("網址或網域").fill("bad");
  await box.getByRole("button", { name: "查詢" }).click();
  await expect(box.getByRole("alert")).toHaveText("看不出是哪個網站，請輸入像 example.com 這樣的網域。");

  await box.getByLabel("網址或網域").fill("ads.example");
  await box.getByRole("button", { name: "查詢" }).click();
  await expect(box.getByTestId("lookup-answer")).toContainText("在擋廣告與追蹤的名單上，只有選了「擋惡意網站、廣告與追蹤」的裝置會擋下它。");

  // the 165 list: appeals go to the hotline, not to us
  await box.getByLabel("網址或網域").fill("scam.example");
  await box.getByRole("button", { name: "查詢" }).click();
  await expect(box.getByTestId("lookup-answer")).toContainText("scam.example 在警政署 165 停止解析的涉詐網站名單上");
  await expect(box.getByTestId("lookup-answer")).toContainText("請撥 165 反詐騙諮詢專線申訴");
  await expect(box.getByRole("link", { name: /回報給我們/ })).toHaveCount(0);

  await box.getByLabel("網址或網域").fill("fakeshop.example");
  await box.getByRole("button", { name: "查詢" }).click();
  await expect(box.getByTestId("lookup-answer")).toContainText("fakeshop.example 在數位產業署停止解析的詐騙購物網站名單上");
  await expect(box.getByTestId("lookup-answer")).toContainText("請向數位產業署申訴");
  await expect(box.getByRole("link", { name: /回報給我們/ })).toHaveCount(0);

  await box.getByLabel("網址或網域").fill("https://phish.example/login");
  await box.getByRole("button", { name: "查詢" }).click();
  await expect(box.getByTestId("lookup-answer")).toContainText("phish.example 在擋惡意網站的名單上");
  // the domain goes in the POST body, never in a URL
  expect(asked.at(-1)).toEqual({ domain: "https://phish.example/login" });

  await box.getByRole("link", { name: "覺得擋錯了？回報給我們" }).click();
  await expect(page).toHaveURL(/\/feedback\/\?from=dns&blocked=phish\.example&list=malware$/);
  await expect(page.getByRole("radio", { name: "其他" })).toBeChecked();
  const attach = page.getByTestId("attach-check");
  await expect(attach).toContainText("附上要回報的網站");
  await expect(attach).toContainText("誤擋回報：phish.example（擋惡意網站的名單）");
});

test("a report link with anything but a host name attaches nothing", async ({ page }) => {
  await page.goto("/feedback/?from=dns&blocked=%3Cscript%3E&list=malware");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("attach-check")).toHaveCount(0);
});
