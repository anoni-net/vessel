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
  const rows = page.getByTestId("lists-table").locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("195,355");
  await expect(rows.nth(1)).toContainText("內政部警政署");
  await expect(rows.nth(3)).toContainText("只有擋廣告");
  await expect(page.getByTestId("lists-share")).toContainText("約 80% 來自 HaGeZi");
  await expect(page.getByTestId("lists-as-of")).toBeVisible();
});

test("the rest of the page stays when the numbers cannot be read", async ({ page }) => {
  await backend(page, 503);
  await page.goto("/dns/lists/");
  await expect(page.getByRole("alert")).toContainText("暫時無法讀取");
  await expect(page.getByTestId("lists-table").locator("tbody tr")).toHaveCount(4);
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
  await expect(page.getByTestId("lists-table").locator(".sk").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "收錄的原則" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a wide screen uses its width: the table across the page, the rest in two columns", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await backend(page);
  await page.goto("/dns/lists/");
  const table = await page.getByTestId("lists-table").boundingBox();
  const how = await page.getByTestId("lists-col-how").boundingBox();
  const problems = await page.getByTestId("lists-col-problems").boundingBox();
  expect(table!.width).toBeGreaterThan(1000);
  expect(Math.abs(how!.y - problems!.y)).toBeLessThan(2);
  expect(problems!.x).toBeGreaterThan(how!.x + how!.width);
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
