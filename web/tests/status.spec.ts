import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";
import en from "../src/i18n/en.json" with { type: "json" };
import zhCN from "../src/i18n/zh-CN.json" with { type: "json" };
import zhTW from "../src/i18n/zh-TW.json" with { type: "json" };
import { REACH_GROUPS } from "../src/reach.ts";

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

// the last day: jp could not open mvdis for 20 hours and did not check twice; ptt failed everywhere, so it is left out
const slots = (fill: string | null, last: Record<number, string | null> = {}) =>
  Array.from({ length: 24 }, (_, i) => (i in last ? last[i] : fill));
const HISTORY = {
  hours: 24,
  until: "2026-11-08T05:30:00Z",
  sites: {
    mvdis: { jp: slots("blocked", { 0: "ok", 1: "ok", 2: null, 3: "ok", 10: null }), tw: slots("ok") },
    bot: { jp: slots("challenge"), tw: slots("ok") },
    ptt: { jp: slots("blocked"), tw: slots("blocked") },
  },
};

test("the last day of the sites a node had trouble with, by the region they serve, a row per node", async ({ page }) => {
  await status(page, { regions: [{ id: "jp", state: "ok" }, { id: "tw", state: "ok" }], notices: [], reach: REACH, reach_history: HISTORY });
  await page.goto("/status/");
  await expect(page.getByTestId("status-reach").locator("> li")).toHaveCount(1);
  const tw = page.getByTestId("status-reach-tw");
  await expect(tw.getByRole("heading", { level: 3 })).toHaveText("台灣的網站");
  await expect(tw.locator(".reach-site > p")).toHaveText(["臺灣銀行", "監理服務網"]);
  const mvdis = page.getByTestId("reach-site-mvdis");
  await expect(mvdis.locator(".reach-row__node")).toHaveText(["東京節點", "台北節點"]);
  await expect(mvdis.locator(".reach-row__now")).toHaveText(["目前打不開", "目前打得開"]);
  // the strip says in words what it shows, the hours included
  await expect(mvdis.getByRole("img").first()).toHaveAttribute("aria-label",
    "東京節點，近 24 小時：打不開 19 次、要通過驗證 0 次、打得開 3 次。打不開的時段：19 小時前到 14 小時前、12 小時前到這一小時");
  await expect(page.getByTestId("reach-site-bot").getByRole("img").first()).toHaveAttribute("aria-label",
    "東京節點，近 24 小時：打不開 0 次、要通過驗證 24 次、打得開 0 次。要通過驗證的時段：23 小時前到這一小時");
  // and by more than colour (WCAG 1.4.1): an hour that did not open stands full height, one that opened is a low bar
  const height = (n: number) => mvdis.locator(".reach-strip").first().locator("rect").nth(n).getAttribute("height");
  expect([await height(0), await height(2), await height(4)]).toEqual(["4", "4", "12"]);
  await expect(mvdis.locator(".reach-strip").first().locator("rect").nth(2)).toHaveClass(/reach-cell--none/);
  await expect(mvdis.locator(".reach-strip").first().locator("rect")).toHaveCount(24);
  await expect(mvdis.locator(".reach-strip").first().locator("rect title").last()).toHaveText("這一小時：打不開");
  await expect(mvdis.locator(".reach-strip").first().locator("rect title").first()).toHaveText("23 小時前：打得開");
  await expect(page.getByTestId("status-reach-legend")).toContainText("打得開要通過驗證打不開沒有檢查");
  await expect(page.getByTestId("status-reach-legend")).toContainText("左邊是 24 小時前，右邊是現在");
  await expect(page.getByTestId("reach-site-ptt")).toHaveCount(0);
  // nothing about the sites is said on the cities' cards
  await expect(page.getByTestId("status-regions")).not.toContainText("打不開");
  const how = page.getByTestId("status-reach-how");
  await how.locator("summary").click();
  await expect(how).toContainText("香港的網站：滙豐香港、恒生銀行");
  await expect(how.getByRole("link", { name: "意見回覆" })).toHaveAttribute("href", "/feedback/?from=status");
});

test("a strip fits a narrow phone, and a wide screen puts the node, the strip and the state on one line", async ({ page }) => {
  await status(page, { regions: [{ id: "jp", state: "ok" }, { id: "tw", state: "ok" }], notices: [], reach: REACH, reach_history: HISTORY });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/status/");
  const row = page.getByTestId("reach-site-mvdis").locator(".reach-row").first();
  const [strip, card] = await Promise.all([row.locator(".reach-strip").boundingBox(), page.getByTestId("status-reach-tw").boundingBox()]);
  expect(strip!.width).toBeGreaterThan(200);
  expect(strip!.x + strip!.width).toBeLessThanOrEqual(card!.x + card!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  const [node, wide] = await Promise.all([row.locator(".reach-row__node").boundingBox(), row.locator(".reach-strip").boundingBox()]);
  expect(Math.abs(node!.y + node!.height / 2 - (wide!.y + wide!.height / 2))).toBeLessThan(4);
});

test("when every node opened every site in the last day, the page says so", async ({ page }) => {
  await status(page, { regions: [{ id: "tw", state: "ok" }], notices: [], reach: [{ region: "tw", checked_at: "2026-11-08T04:25:00Z", sites: { signal: "ok" } }],
    reach_history: { hours: 24, until: "2026-11-08T05:30:00Z", sites: {} } });
  await page.goto("/status/");
  await expect(page.getByTestId("status-reach-none")).toHaveText("近 24 小時各節點都打得開檢查的網站。");
});

test("without a recent check, a city shows nothing about sites", async ({ page }) => {
  await status(page, { regions: [{ id: "sg", state: "ok" }], notices: [] });
  await page.goto("/status/");
  await expect(page.getByTestId("status-regions").locator("li")).toHaveText([/新加坡\s*正常/]);
  await expect(page.locator("#reach")).toHaveCount(0);
});

test("every site the nodes check has a name in each language and the same region as on the page", () => {
  const rows = readFileSync(new URL("../../node/reach-sites.tsv", import.meta.url), "utf-8")
    .split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("\t"));
  const ids = rows.map((r) => r[0]);
  expect(ids.length).toBeGreaterThanOrEqual(20);
  expect(Object.fromEntries(rows.map((r) => [r[0], r[1]]))).toEqual(
    Object.fromEntries(Object.entries(REACH_GROUPS).flatMap(([group, sites]) => sites.map((s) => [s, group]))));
  for (const messages of [zhTW, zhCN, en] as Record<string, string>[]) {
    expect(ids.filter((id) => !messages[`reach.site.${id}`])).toEqual([]);
  }
});
