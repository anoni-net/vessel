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
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["查詢網站有沒有被擋", "檢查目前的過濾", "三種選項", "運作方式", "做不到的事", "更換與回報"]);
  await page.goto("/en/dns/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("DNS filtering");
  await expect(page.locator(".dns-page").getByRole("link", { name: "The lists behind the DNS filter" })).toHaveAttribute("href", "/en/dns/lists/");
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
  await expect(box.getByTestId("lookup-answer")).toContainText("good.example 不在 Vessel 的名單上，應該不是名單擋的");
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
  await expect(box.getByTestId("lookup-answer")).toContainText("scam.example 在台灣警政署 165 停止解析的涉詐網站名單上");
  await expect(box.getByTestId("lookup-answer")).toContainText("請撥 165 反詐騙諮詢專線申訴");
  await expect(box.getByTestId("lookup-answer").getByRole("link", { name: "為什麼會被擋、可以怎麼處理" })).toHaveAttribute("href", "/dns/lists/#trouble");
  await expect(box.getByRole("link", { name: /回報給我們/ })).toHaveCount(0);

  await box.getByLabel("網址或網域").fill("fakeshop.example");
  await box.getByRole("button", { name: "查詢" }).click();
  await expect(box.getByTestId("lookup-answer")).toContainText("fakeshop.example 在台灣數位產業署停止解析的詐騙購物網站名單上");
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

test("a section heading sits closer to its own text than to the section before", async ({ page }) => {
  await page.goto("/dns/");
  // the second heading of its column, so there is a section before it at every width
  const heading = page.getByTestId("dns-col-limits").locator("h2").nth(1);
  const gaps = await heading.evaluate((h) => {
    const box = h.getBoundingClientRect();
    return {
      above: box.top - h.previousElementSibling!.getBoundingClientRect().bottom,
      below: h.nextElementSibling!.getBoundingClientRect().top - box.bottom,
    };
  });
  expect(gaps.above).toBeGreaterThan(gaps.below * 2);
});

test("a wide screen shows the tools and the options side by side, a phone stacks them", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dns/");
  const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
  const check = await box("dns-check");
  const lookup = await box("dns-lookup");
  expect(Math.abs(check.y - lookup.y)).toBeLessThan(2);
  expect(check.x).toBeGreaterThan(lookup.x + lookup.width);
  const how = await box("dns-col-how");
  const limits = await box("dns-col-limits");
  expect(Math.abs(how.y - limits.y)).toBeLessThan(2);
  const tops = await page.locator(".dns-options > .card").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await page.setViewportSize({ width: 390, height: 800 });
  const after = await box("dns-check");
  expect(after.y).toBeGreaterThan((await box("dns-lookup")).y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a site Quad9 blocks says so, and can be looked up there and reported", async ({ page }) => {
  await page.route("**/api/blocklist", (route) => route.fulfill({ json: { domain: "phish.example", malware: false, tw165: false, twmoda: false, ads: false, quad9: true } }));
  await page.goto("/dns/");
  const box = page.getByTestId("dns-lookup");
  await box.getByLabel("網址或網域").fill("phish.example");
  await box.getByRole("button", { name: "查詢" }).click();
  const answer = box.getByTestId("lookup-answer");
  await expect(answer).toContainText("被 Quad9 判斷為有害");
  await expect(answer.getByRole("link", { name: "到 Quad9 查詢判斷的來源" })).toHaveAttribute("href", "https://quad9.net/result/");
  await expect(answer.getByRole("link", { name: /回報給我們/ })).toHaveAttribute("href", /list=quad9/);
});

test("a site on the ad list that Quad9 also blocks counts as blocked by both filters", async ({ page }) => {
  await page.route("**/api/blocklist", (route) => route.fulfill({ json: { domain: "x.example", malware: false, tw165: false, twmoda: false, ads: true, quad9: true } }));
  await page.goto("/dns/");
  const box = page.getByTestId("dns-lookup");
  await box.getByLabel("網址或網域").fill("x.example");
  await box.getByRole("button", { name: "查詢" }).click();
  await expect(box.getByTestId("lookup-answer")).toContainText("被 Quad9 判斷為有害");
});
