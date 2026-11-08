import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";
import en from "../src/i18n/en.json" with { type: "json" };
import zhCN from "../src/i18n/zh-CN.json" with { type: "json" };
import zhTW from "../src/i18n/zh-TW.json" with { type: "json" };

// jp cannot open two sites Taipei opens and meets a bot check at a third; no node opens ptt, so it is not the node's fault
const REACH = [
  { region: "jp", checked_at: "2026-11-08T04:20:00Z", sites: { mvdis: "blocked", momo: "blocked", bot: "challenge", ptt: "blocked", signal: "ok" } },
  { region: "tw", checked_at: "2026-11-08T04:25:00Z", sites: { mvdis: "ok", momo: "ok", bot: "ok", ptt: "blocked", signal: "ok" } },
];

async function status(page: Page, body: unknown, code = 200) {
  await page.route("**/api/status", (route) => route.fulfill({ status: code, json: body }));
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
}

test("nodes and notices", async ({ page }) => {
  await status(page, {
    regions: [{ id: "jp", state: "down" }, { id: "sg", state: "ok" }],
    notices: [
      { region: "jp", kind: "outage", starts_at: "2026-10-29T03:00:00Z", ends_at: null },
      { region: null, kind: "restart", starts_at: "2026-10-28T04:52:00Z", ends_at: "2026-10-28T04:54:00Z" },
    ],
  });
  await page.goto("/status/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("服務狀態");
  const regions = page.getByTestId("status-regions").locator("li");
  await expect(regions).toHaveText([/東京\s*無法連線/, /新加坡\s*正常/]);
  const notices = page.getByTestId("status-notices").locator("li");
  await expect(notices).toHaveCount(2);
  await expect(notices.nth(0)).toContainText("連線中斷 · 東京");
  await expect(notices.nth(0)).toContainText("進行中");
  await expect(notices.nth(0)).toContainText("起");
  await expect(notices.nth(1)).toContainText("節點重新啟動 · 所有城市");
  await expect(notices.nth(1)).toContainText("至");
  await expect(notices.nth(1)).toContainText("連線中斷幾秒，App 會自動重新連上。");
  await expect(page.getByTestId("status-updated")).toContainText("更新於");
  await page.getByRole("link", { name: "回報問題或給建議" }).click();
  await expect(page).toHaveURL(/\/feedback\/\?from=status$/);
});

test("no notices, and a worker nobody heard from", async ({ page }) => {
  await status(page, { regions: [{ id: "sg", state: "unknown" }], notices: [] });
  await page.goto("/status/");
  await expect(page.getByTestId("status-regions").locator("li")).toHaveText([/新加坡\s*無法確認/]);
  await expect(page.getByTestId("status-none")).toHaveText("最近 30 天沒有維護或中斷的紀錄。");
});

test("a failed load says so", async ({ page }) => {
  await status(page, { error: "unknown" }, 502);
  await page.goto("/status/");
  await expect(page.getByRole("alert")).toHaveText("無法取得狀態，請稍後再試。");
});

test("linked from the footer and the feedback page, in three languages", async ({ page }) => {
  await status(page, { regions: [{ id: "sg", state: "ok" }], notices: [] });
  await page.goto("/feedback/");
  await page.locator("main").getByRole("link", { name: "服務狀態" }).click();
  await expect(page).toHaveURL(/\/status\/$/);
  await page.goto("/en/");
  await page.locator("footer").getByRole("link", { name: "Service status" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Service status");
  await expect(page.getByTestId("status-regions").locator("li")).toHaveText([/Singapore\s*Working/]);
  await page.goto("/zh-cn/status/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("服务状态");
});

test("a wide screen shows the cities side by side and the notices in columns, a phone stacks them", async ({ page }) => {
  await status(page, {
    regions: [{ id: "jp", state: "ok" }, { id: "sg", state: "ok" }, { id: "tw", state: "ok" }],
    notices: [1, 2, 3].map((d) => ({ region: "jp", kind: "restart", starts_at: `2026-10-2${d}T03:00:00Z`, ends_at: `2026-10-2${d}T04:00:00Z` })),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/status/");
  const top = async (id: string) => page.getByTestId(id).locator("li").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  await expect(page.getByTestId("status-notices").locator("li")).toHaveCount(3);
  expect(new Set(await top("status-regions")).size).toBe(1);
  expect(new Set(await top("status-notices")).size).toBe(1);
  await page.setViewportSize({ width: 390, height: 800 });
  expect(new Set(await top("status-regions")).size).toBe(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("under each city, the sites its node cannot open that another city's can", async ({ page }) => {
  await status(page, { regions: [{ id: "jp", state: "ok" }, { id: "tw", state: "ok" }], notices: [], reach: REACH });
  await page.goto("/status/");
  const jp = page.getByTestId("status-reach-jp");
  await expect(jp.locator("p")).toHaveText(["打不開：監理服務網、momo 購物網", "可能要先通過驗證：臺灣銀行"]);
  await expect(page.getByTestId("status-reach-tw")).toHaveText("檢查的網站都打得開");
  const how = page.getByTestId("status-reach-how");
  await how.locator("summary").click();
  await expect(how).toContainText("監理服務網、momo 購物網、臺灣銀行、PTT、Signal");
});

test("without a recent check, a city shows nothing about sites", async ({ page }) => {
  await status(page, { regions: [{ id: "sg", state: "ok" }], notices: [] });
  await page.goto("/status/");
  await expect(page.getByTestId("status-regions").locator("li")).toHaveText([/新加坡\s*正常/]);
  await expect(page.locator("[data-testid^=status-reach]")).toHaveCount(0);
});

test("every site the nodes check has a name in each language", () => {
  const ids = readFileSync(new URL("../../node/reach-sites.tsv", import.meta.url), "utf-8")
    .split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("\t")[0]);
  expect(ids.length).toBeGreaterThanOrEqual(20);
  for (const messages of [zhTW, zhCN, en] as Record<string, string>[]) {
    expect(ids.filter((id) => !messages[`reach.site.${id}`])).toEqual([]);
  }
});
