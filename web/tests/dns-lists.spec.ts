import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

const SUMMARY = {
  lists: [
    { id: "malware", domains: 195355, only_here: 90000 },
    { id: "tw165", domains: 86154, only_here: 86000 },
    { id: "twmoda", domains: 1664, only_here: 1600 },
    { id: "stalkerware", domains: 929, only_here: 900 },
    { id: "cti", domains: 381000, only_here: 378000 },
    { id: "ads", domains: 219320, only_here: 149750 },
  ],
  malware_filter: 282967,
  ads_filter: 432717,
  hagezi: 345105,
  as_of: "2026-11-07T04:00:00+00:00",
};

async function backend(page: Page, code = 200) {
  await page.route("**/api/blocklist/lists", (route) => route.fulfill({ status: code, json: code === 200 ? SUMMARY : { error: "lists_loading" } }));
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
}

const openMore = (page: Page) => page.getByTestId("lists-more").locator("summary").click();

test("the page answers what to pick first, then what to do when a site will not open", async ({ page }) => {
  await backend(page);
  await page.goto("/dns/lists/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("網域過濾的名單");
  await expect(page.locator(".lead")).toContainText("選建議的「擋惡意網站」");
  const choices = page.getByTestId("lists-choices").locator("li");
  await expect(choices).toHaveCount(3);
  // the same names as making a device and the device list
  await expect(choices.locator("h3")).toHaveText(["不過濾", /^擋惡意網站\s*建議$/, "擋惡意網站、廣告與追蹤"]);
  // the same strength marks as when making a device: one, two and three filled
  for (const [i, filled] of [[0, 1], [1, 2], [2, 3]] as const) {
    await expect(choices.nth(i).locator(".layers > span")).toHaveCount(3);
    await expect(choices.nth(i).locator(".layers__on")).toHaveCount(filled);
  }
  const headings = await page.locator(".lists-page > h2, .lists-col > h2").allInnerTexts();
  expect(headings.slice(0, 4)).toEqual(["要選哪一個", "網站打不開時", "常見的疑問", "目前的名單"]);
  const steps = page.getByTestId("lists-trouble").locator("ol > li");
  await expect(steps).toHaveCount(4);
  // look it up first: being able to open it with the VPN off does not mean a list blocked it
  await expect(steps.nth(0).getByRole("link", { name: "網域過濾頁" })).toHaveAttribute("href", "/dns/");
  await expect(steps.nth(1).getByRole("link", { name: "意見回覆" })).toHaveAttribute("href", "/feedback/");
  await expect(steps.nth(2).getByRole("link", { name: "我的裝置" })).toHaveAttribute("href", "/devices/");
  await expect(steps.nth(3).getByRole("link", { name: "意見回覆" })).toBeVisible();
  // changing the option means making the device again: said where people choose, not only in the questions
  await expect(page.getByTestId("lists-choose-note")).toContainText("刪掉裝置再重新建立");
});

test("the common questions open, and say the filter keeps no record", async ({ page }) => {
  await backend(page);
  await page.goto("/dns/lists/");
  const question = page.getByTestId("lists-questions").locator("details").filter({ hasText: "Vessel 會記錄我查了哪些網站嗎？" });
  await question.locator("summary").click();
  await expect(question).toContainText("不留下紀錄");
  await expect(question.getByRole("link", { name: "VPN 入門" })).toBeVisible();
  await expect(question).toContainText("看得到查詢的網域與節點的 IP");
});

test("the lists say what they block first, and are grouped by what people pick", async ({ page }) => {
  await backend(page);
  await page.goto("/dns/lists/");
  const malware = page.getByTestId("list-malware");
  await expect(malware.locator(".lists-card__name")).toHaveText("惡意程式與釣魚網站");
  await expect(malware.getByRole("link", { name: "HaGeZi Threat Intelligence Feeds（mini）" })).toBeVisible();
  await expect(malware).toContainText("195,355");
  await expect(page.getByTestId("list-tw165")).toContainText("內政部警政署");
  const groups = page.getByTestId("lists-groups").locator("section");
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).locator("li")).toHaveCount(5);
  await expect(groups.nth(1)).toContainText("只有選「擋惡意網站、廣告與追蹤」才擋");
  await expect(page.getByTestId("lists-as-of")).toBeVisible();
});

test("the details are folded away, and the page says who runs it and what it does not know", async ({ page }) => {
  await backend(page);
  await page.goto("/dns/lists/");
  await expect(page.getByTestId("lists-more")).not.toHaveAttribute("open");
  await expect(page.getByTestId("lists-chart-overlap")).toBeHidden();
  await expect(page.getByText("法律主體還在確認")).toBeVisible();
  await expect(page.getByText("審查與移除程序我們並不清楚")).toBeVisible();
  await expect(page.getByText("都包含兩份台灣政府的名單")).toBeVisible();
  await expect(page.getByText("沒有政府單位要求 Vessel 加入或移除網域")).toBeVisible();
  await expect(page.getByRole("link", { name: "whisper@anoni.net" })).toHaveAttribute("href", "mailto:whisper@anoni.net");
  await expect(page.getByRole("link", { name: "常見問題的這一題" })).toHaveAttribute("href", "/faq/#q-risky");
  await openMore(page);
  await expect(page.getByTestId("lists-chart-overlap")).toBeVisible();
  await expect(page.getByTestId("lists-share")).toContainText("約 80% 來自 HaGeZi");
  await expect(page.getByTestId("lists-more")).toContainText("2026 年底前");
});

test("the rest of the page stays when the numbers cannot be read", async ({ page }) => {
  await backend(page, 503);
  await page.goto("/dns/lists/");
  await expect(page.getByRole("alert")).toContainText("暫時無法讀取");
  await expect(page.getByTestId("lists-groups").locator("li")).toHaveCount(6);
  await openMore(page);
  await expect(page.getByTestId("lists-excluded")).toContainText("from-ia.com");
  await expect(page.getByTestId("lists-chart-overlap")).toHaveCount(0);
});

test("the page lists the same names as node/exclude.txt", async ({ page }) => {
  const names = readFileSync(new URL("../../node/exclude.txt", import.meta.url), "utf-8")
    .split("\n").map((line) => line.split("#")[0].trim()).filter(Boolean);
  await backend(page);
  await page.goto("/dns/lists/");
  await openMore(page);
  await expect(page.getByTestId("lists-excluded").locator("code")).toHaveCount(names.length);
  const shown = await page.getByTestId("lists-excluded").locator("code").allTextContents();
  expect([...shown].sort()).toEqual([...names].sort());
});

test("the excluded domains are grouped by reason, each reason said once, the largest group first", async ({ page }) => {
  await backend(page);
  await page.goto("/dns/lists/");
  await openMore(page);
  const groups = page.getByTestId("lists-excluded").locator(".lists-exclude__group");
  const reasons = await groups.evaluateAll((els) => els.map((el) => el.getAttribute("data-reason")));
  expect(new Set(reasons).size).toBe(reasons.length);
  const sizes = await groups.evaluateAll((els) => els.map((el) => el.querySelectorAll("code").length));
  expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  await expect(groups.first().locator("dt")).toHaveText("託管、架站、動態 DNS 或基礎設施服務的共用網域，底下的網站屬於不同的人，擋了會連帶擋到無關的網站");
  await expect(groups.first().locator("code").first()).toHaveText("3322.org");
  await expect(page.getByTestId("lists-excluded").locator("xpath=preceding-sibling::p[1]")).toContainText(`仍然可能被擋。目前排除 ${sizes.reduce((a, b) => a + b)} 個網域，依排除的理由分組。`);
  await page.goto("/en/dns/lists/");
  await openMore(page);
  await expect(page.getByTestId("lists-excluded").locator("xpath=preceding-sibling::p[1]")).toContainText(`can still be blocked. ${sizes.reduce((a, b) => a + b)} domains are left out`);
});

test("every language has the page, and the DNS filter page links to it", async ({ page }) => {
  await backend(page);
  await page.goto("/en/dns/");
  await page.locator(".dns-page").getByRole("link", { name: "The lists behind the DNS filter" }).click();
  await expect(page).toHaveURL(/\/en\/dns\/lists\/$/);
  await expect(page.locator(".lead")).toContainText("Block malware");
  await page.goto("/zh-cn/dns/lists/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("域名过滤的名单");
});

test("the text is there before the numbers arrive, and nothing overflows on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
  await page.route("**/api/blocklist/lists", () => {});
  await page.goto("/dns/lists/");
  await expect(page.getByTestId("lists-groups").locator(".sk").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "收錄的原則" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a wide screen uses its width: the cards side by side, the rest in two columns", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await backend(page);
  await page.goto("/dns/lists/");
  const groups = await page.getByTestId("lists-groups").boundingBox();
  const first = await page.getByTestId("list-malware").boundingBox();
  const last = await page.getByTestId("list-ads").boundingBox();
  const how = await page.getByTestId("lists-col-how").boundingBox();
  const problems = await page.getByTestId("lists-col-problems").boundingBox();
  expect(groups!.width).toBeGreaterThan(1000);
  expect(Math.abs(first!.y - last!.y)).toBeLessThan(2);
  expect(Math.abs(first!.height - last!.height)).toBeLessThan(2);
  const numbers = await page.locator(".lists-card__number").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().bottom)));
  expect(new Set(numbers).size).toBe(1);
  expect(Math.abs(how!.y - problems!.y)).toBeLessThan(2);
  expect(problems!.x).toBeGreaterThan(how!.x + how!.width);
});

test("a long list name wraps and its numbers stay inside the chart on a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await backend(page);
  await page.goto("/dns/lists/");
  await openMore(page);
  const plot = await page.getByTestId("lists-chart-overlap").locator(".lists-bar__plot").first().boundingBox();
  const values = page.getByTestId("lists-chart-overlap").locator(".lists-bar__value");
  await expect(values).toHaveCount(6);
  for (const box of await values.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) {
    expect(box).toBeLessThanOrEqual(plot!.x + plot!.width + 1);
  }
});

test("the charts carry the numbers, with labels for screen readers", async ({ page }) => {
  await backend(page);
  await page.goto("/dns/lists/");
  await openMore(page);
  const overlap = page.getByTestId("lists-chart-overlap");
  await expect(overlap.locator(".lists-chart__bars li svg")).toHaveCount(6);
  await expect(overlap.getByRole("img", { name: "惡意程式與釣魚網站：共 195,355 個網域，其中 90,000 個獨有" })).toBeVisible();
  // the same names as the cards above, so nobody has to work out which is which
  for (const id of ["malware", "tw165", "twmoda", "stalkerware", "cti", "ads"]) {
    const name = await page.getByTestId(`list-${id}`).locator(".lists-card__name").innerText();
    await expect(overlap.locator(".lists-bar__head").filter({ hasText: name })).toHaveCount(1);
  }
  // largest first
  await expect(overlap.locator(".lists-chart__bars > li")).toHaveText([/^確認活躍的惡意網站/, /^廣告與追蹤/, /^惡意程式與釣魚網站/, /^假投資/, /^電商通報/, /^跟蹤軟體/]);
  // rounded down, so 99.8% does not read as nothing shared
  await expect(overlap.locator(".lists-chart__bars > li").filter({ hasText: "假投資" })).toContainText("獨有 99%");
  await expect(overlap.locator(".lists-chart__bars > li").filter({ hasText: "惡意程式與釣魚網站" })).toContainText("獨有 46%");
  // the longest list fills the width, the others in proportion
  const ads = overlap.getByRole("img", { name: /^廣告與追蹤/ });
  expect(await ads.locator("rect.lists-bar__first").first().getAttribute("width")).toBe(`${(149750 / 381000) * 100}%`);
});

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const colorScheme of ["light", "dark"] as const) {
  test(`WCAG 1.4.11: both parts of a bar reach 3:1 against the page, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await backend(page);
    await page.goto("/dns/lists/");
    const color = (name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
    const surface = await color("--page");
    expect(contrast(await color("--chart-first"), surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(await color("--chart-rest"), surface)).toBeGreaterThanOrEqual(3);
  });
}

test("WCAG 1.4.1: the overlapping part is hatched, not only a different color, in the bars and the legend", async ({ page }) => {
  await backend(page);
  await page.goto("/dns/lists/");
  await openMore(page);
  const overlap = page.getByTestId("lists-chart-overlap");
  await expect(overlap.getByRole("img").first().locator('rect[fill="url(#lists-hatch)"]').first()).toBeAttached();
  await expect(overlap.locator('.lists-chart__legend rect[fill="url(#lists-hatch)"]')).toHaveCount(1);
  await expect(page.locator("pattern#lists-hatch")).toHaveCount(1);
});

test("WCAG 1.4.10 and 1.4.12: at 320 px with wider text spacing nothing runs off the page", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await backend(page);
  await page.goto("/dns/lists/");
  await openMore(page);
  await expect(page.getByTestId("lists-chart-overlap").getByRole("img").first()).toBeVisible();
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync("* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // the column names of the tables shown as cards are clipped to a pixel for screen readers, and not drawn
  const cut = await page.locator(".lists-page *").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && e.tagName !== "rect" && e.tagName !== "pattern" && !e.closest(".lists-compare thead, .legal thead")).map((e) => e.tagName + "." + e.getAttribute("class")).slice(0, 5));
  expect(cut).toEqual([]);
});

test("WCAG 2.1.1 and 2.4.7: the folded parts and links are reached by keyboard with a visible focus ring", async ({ page }) => {
  await backend(page);
  await page.goto("/dns/lists/");
  const link = page.getByTestId("list-malware").locator("a");
  await link.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  expect(await link.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe("solid");
  expect(await link.evaluate((e) => parseFloat(getComputedStyle(e).outlineWidth))).toBeGreaterThanOrEqual(2);
  const more = page.getByTestId("lists-more").locator("summary");
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("lists-more")).toHaveAttribute("open");
});

test("WCAG 1.3.1: the tables keep their headers on a phone, and loading is announced as busy", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
  await page.route("**/api/blocklist/lists", () => {});
  await page.goto("/dns/lists/");
  await expect(page.getByTestId("lists-groups")).toHaveAttribute("aria-busy", "true");
  await openMore(page);
  // the comparison and the notes on sites in inspection reports; the excluded domains are a list of reasons and names
  await expect(page.getByRole("table")).toHaveCount(2);
  await expect(page.getByTestId("lists-compare").getByRole("columnheader")).toHaveCount(4);
  await expect(page.getByTestId("lists-notes-table").getByRole("columnheader")).toHaveCount(5);
});

test("the page can be reached from the footer, the FAQ and the DNS filter page, and step by anchor", async ({ page }) => {
  await backend(page);
  await page.goto("/faq/");
  await expect(page.locator("footer").getByRole("link", { name: "網域過濾的名單" })).toHaveAttribute("href", "/dns/lists/");
  const filter = page.locator("details#q-filter");
  await filter.locator("summary").click();
  await expect(filter.getByRole("link", { name: "網域過濾的名單" })).toHaveAttribute("href", "/dns/lists/");
  await page.goto("/dns/");
  // near the options, above how it works
  const link = page.locator(".dns-page").getByRole("link", { name: "網域過濾的名單" });
  const how = page.getByRole("heading", { name: "運作方式" });
  expect((await link.boundingBox())!.y).toBeLessThan((await how.boundingBox())!.y);
  await page.goto("/dns/lists/#trouble");
  await expect(page.getByRole("heading", { name: "網站打不開時" })).toBeInViewport();
});

test("the page compares with other services in the open, weak points included", async ({ page }) => {
  await backend(page);
  await page.goto("/dns/lists/");
  const rows = page.getByTestId("lists-compare").locator("tbody tr");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(1)).toContainText("釣魚網站，一天後");
  await expect(rows.nth(3)).toContainText("100%");
  await expect(page.getByText("對 phishunt.io 回報的網站比 Cloudflare 少")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Vessel 擋惡意網站", exact: true })).toBeAttached();
  await expect(page.getByRole("columnheader", { name: "Cloudflare 1.1.1.2" })).toBeAttached();
  await expect(page.getByTestId("list-quad9").getByRole("link", { name: "Quad9 的查詢頁" })).toHaveAttribute("href", "https://quad9.net/result/");
  await expect(page.getByText("沒有開啟過濾時不會擋任何網站")).toBeVisible();
  await openMore(page);
  const panels = page.getByTestId("lists-phishing").locator("figure");
  await expect(panels).toHaveCount(3);
  await expect(panels.nth(0).getByRole("img")).toHaveCount(3);
  await expect(panels.nth(0).getByRole("img", { name: "Cloudflare 1.1.1.2 87%" })).toBeVisible();
  await expect(panels.nth(2).getByRole("img", { name: "Vessel 擋惡意網站 32%" })).toBeVisible();
  await expect(page.getByText("在那個來源的比例會偏高")).toBeVisible();
  await expect(page.getByText("DNSBunker CTI 沒有擋到測試清單")).toBeAttached();
});

test("the comparison fits a narrow phone with its column names beside the values", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await backend(page);
  await page.goto("/dns/lists/");
  const cell = page.getByTestId("lists-compare").locator("tbody tr").first().locator("td").first();
  expect(await cell.evaluate((e) => getComputedStyle(e, "::before").content)).toContain("Vessel 擋惡意網站");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("phishing that the lists miss: the page, the FAQ and the DNS page say so and say what helps", async ({ page }) => {
  await backend(page);
  await page.goto("/dns/lists/");
  await expect(page.getByTestId("lists-protect").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("lists-protect")).toContainText("passkey");
  await page.goto("/faq/#q-phishing");
  const question = page.locator("details#q-phishing");
  await expect(question).toHaveAttribute("open");
  await expect(question).toContainText("不能當成唯一的防護");
  await expect(question.getByRole("link", { name: "名單以外的防護與量測結果" })).toHaveAttribute("href", "/dns/lists/#beyond-the-lists");
  await page.goto("/dns/");
  await expect(page.locator(".dns-page")).toContainText("剛出現的釣魚網站");
});
