import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

const SUMMARY = {
  lists: [
    { id: "malware", domains: 195355, only_here: 90000 },
    { id: "tw165", domains: 86154, only_here: 86000 },
    { id: "twmoda", domains: 1664, only_here: 1600 },
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

test("the lists with who maintains them and their sizes", async ({ page }) => {
  await backend(page);
  await page.goto("/dns/lists/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("網域過濾的名單");
  await expect(page.getByTestId("list-malware")).toContainText("195,355");
  await expect(page.getByTestId("list-tw165")).toContainText("內政部警政署");
  // the lists are grouped by what people pick for a device
  const groups = page.getByTestId("lists-groups").locator("section");
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).locator("li")).toHaveCount(3);
  await expect(groups.nth(1)).toContainText("選「擋惡意網站、廣告與追蹤」才擋");
  await expect(groups.nth(1).locator("li")).toContainText("Multi PRO");
  await expect(page.getByTestId("lists-share")).toContainText("約 80% 來自 HaGeZi");
  await expect(page.getByTestId("lists-as-of")).toBeVisible();
});

test("the rest of the page stays when the numbers cannot be read", async ({ page }) => {
  await backend(page, 503);
  await page.goto("/dns/lists/");
  await expect(page.getByRole("alert")).toContainText("暫時無法讀取");
  await expect(page.getByTestId("lists-groups").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("lists-excluded")).toContainText("from-ia.com");
});

test("the page lists the same names as node/exclude.txt", async ({ page }) => {
  const names = readFileSync(new URL("../../node/exclude.txt", import.meta.url), "utf-8")
    .split("\n").map((line) => line.split("#")[0].trim()).filter(Boolean);
  await backend(page);
  await page.goto("/dns/lists/");
  await expect(page.getByTestId("lists-excluded").locator("tbody code")).toHaveText(names);
});

test("every language has the page, and the DNS filter page links to it", async ({ page }) => {
  await backend(page);
  await page.goto("/en/dns/");
  await page.getByRole("link", { name: "The lists behind the DNS filter" }).click();
  await expect(page).toHaveURL(/\/en\/dns\/lists\/$/);
  await expect(page.getByTestId("lists-log").locator("li").first()).toContainText("exclusion list");
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

test("a wide screen uses its width: the table across the page, the rest in two columns", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await backend(page);
  await page.goto("/dns/lists/");
  const groups = await page.getByTestId("lists-groups").boundingBox();
  const first = await page.getByTestId("list-malware").boundingBox();
  const last = await page.getByTestId("list-ads").boundingBox();
  const how = await page.getByTestId("lists-col-how").boundingBox();
  const problems = await page.getByTestId("lists-col-problems").boundingBox();
  expect(groups!.width).toBeGreaterThan(1000);
  // the four lists side by side, the same height
  expect(Math.abs(first!.y - last!.y)).toBeLessThan(2);
  expect(Math.abs(first!.height - last!.height)).toBeLessThan(2);
  // the numbers line up along the bottom of the cards
  const numbers = await page.locator(".lists-card__number").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().bottom)));
  expect(new Set(numbers).size).toBe(1);
  expect(Math.abs(how!.y - problems!.y)).toBeLessThan(2);
  expect(problems!.x).toBeGreaterThan(how!.x + how!.width);
});

test("a long list name wraps and its numbers stay inside the chart on a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await backend(page);
  await page.goto("/dns/lists/");
  const plot = await page.getByTestId("lists-chart-overlap").locator(".lists-bar__plot").first().boundingBox();
  const values = page.getByTestId("lists-chart-overlap").locator(".lists-bar__value");
  await expect(values).toHaveCount(4);
  for (const box of await values.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) {
    expect(box).toBeLessThanOrEqual(plot!.x + plot!.width + 1);
  }
});

test("the sections stack in one column on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await backend(page);
  await page.goto("/dns/lists/");
  const share = await page.getByRole("heading", { name: "名單的組成" }).boundingBox();
  const known = await page.getByRole("heading", { name: "已知的問題" }).boundingBox();
  expect(known!.y).toBeGreaterThan(share!.y);
  expect(Math.abs(known!.x - share!.x)).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the charts carry the numbers, with labels for screen readers", async ({ page }) => {
  await backend(page);
  await page.goto("/dns/lists/");
  const overlap = page.getByTestId("lists-chart-overlap");
  await expect(overlap.locator("li svg")).toHaveCount(4);
  await expect(overlap.getByRole("img", { name: "HaGeZi Threat Intelligence Feeds（mini）：共 195,355 個網域，其中 90,000 個獨有" })).toBeVisible();
  // the same names as the cards above, so nobody has to work out which is which
  for (const id of ["malware", "tw165", "twmoda", "ads"]) {
    const name = await page.getByTestId(`list-${id}`).locator("a").innerText();
    await expect(overlap.locator(".lists-bar__head").filter({ hasText: name })).toHaveCount(1);
  }
  // largest first
  await expect(overlap.locator(".lists-chart__bars > li")).toHaveText([/^HaGeZi Multi PRO/, /^HaGeZi Threat/, /^165 遭停止解析/, /^詐騙網域停止解析清單/]);
  // rounded down, so 99.8% does not read as nothing shared
  await expect(overlap.locator("li").filter({ hasText: "165" })).toContainText("獨有 99%");
  await expect(overlap.locator("li").filter({ hasText: "HaGeZi Threat" })).toContainText("獨有 46%");
  // the longest list fills the width, the others in proportion
  const ads = overlap.getByRole("img", { name: /^HaGeZi Multi PRO/ });
  expect(await ads.locator("rect.lists-bar__first").first().getAttribute("width")).toBe(`${(149750 / 219320) * 100}%`);
  const kinds = page.getByTestId("lists-chart-kinds");
  await expect(kinds.getByRole("img")).toHaveCount(5);
  await expect(kinds.getByRole("img", { name: "金融保險 53%" })).toBeVisible();
});

test("a failed read leaves out the chart of live numbers, the cards still have the lists", async ({ page }) => {
  await backend(page, 503);
  await page.goto("/dns/lists/");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("lists-chart-overlap")).toHaveCount(0);
  await expect(page.getByTestId("lists-chart-kinds").getByRole("img")).toHaveCount(5);
});
