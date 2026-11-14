import { type Page, expect, test } from "@playwright/test";

// The sample report (/sample-report/): the report page's own view of a made-up report, for anyone, signed in or not
test.use({ timezoneId: "Asia/Taipei" });

const signedOut = async (page: Page) => {
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
  await page.route("**/api/pickup", (route) => route.fulfill({ json: { open: false } }));
};

test("from the home page to a sample report anyone can read, every card of it marked as a sample", async ({ page }) => {
  await signedOut(page);
  // nothing of the report is asked of the backend
  const asked: string[] = [];
  const blocked: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && /style-src/.test(m.text())) blocked.push(m.text()); });
  page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/api/") && !/\/api\/(me|pickup)$/.test(new URL(r.url()).pathname)) asked.push(r.url()); });
  await page.goto("/");
  await expect(page.locator("#inspect").getByRole("heading", { level: 2 })).toContainText("裝置流量檢測");
  await expect(page.locator("#inspect")).toContainText("個人帳號與團體帳號都能");
  await page.getByTestId("home-sample").click();
  await expect(page).toHaveURL(/\/sample-report\/$/);
  await expect(page).toHaveTitle("檢測報告範例 · Vessel");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("檢測報告範例");
  await expect(page.getByTestId("sample-fake")).toContainText("不是任何人的真實報告");
  // a phone like most: two ad redirects one evening, a check, said to look like ads
  const verdict = page.getByTestId("inspect-verdict");
  await expect(page.getByTestId("sample-case-check")).toHaveAttribute("aria-pressed", "true");
  await expect(verdict).toHaveAttribute("data-state", "check");
  await expect(page.getByTestId("inspect-reason")).toContainText("比較像瀏覽網頁時遇到的廣告");
  await expect(page.getByTestId("inspect-hit")).toHaveCount(2);
  await expect(page.getByTestId("inspect-hit").filter({ hasText: "magsrv.com" }).getByTestId("inspect-hit-blocked")).toHaveText("Vessel 擋下其中 2 次，1 次沒有擋下");
  // every card says it is a sample, and a note goes before each part
  await expect(page.getByTestId("sample-mark")).toHaveCount(4);
  for (const card of await page.locator(".inspect-report > .card").all()) await expect(card.getByTestId("sample-mark")).toHaveText("範例資料");
  await expect(page.locator(".sample-note")).toHaveCount(3);
  await expect(page.getByTestId("sample-note-findings")).toContainText("你連過的其他網站不會出現");
  // the other observations of a real report: a few unencrypted pages, a casting app, an app checking in
  await expect(page.getByTestId("inspect-plain").locator("summary")).toHaveText("有 4 次網頁連線沒有加密");
  await expect(page.getByTestId("inspect-local")).toHaveCount(1);
  await expect(page.getByTestId("inspect-timers").locator("summary")).toHaveText("有 1 個目的地定時連線（約每 30 分鐘）");
  // the week's days and hours are drawn
  await expect(page.locator(".inspect-report .tiles__row[data-day]")).toHaveCount(7);
  // the days' bars have their heights, from classes: the policy (style-src 'self') would drop a style attribute in the
  // prerendered page, and says so in the console
  for (const fill of await page.locator(".cover__fill").all()) expect(await fill.evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThan(0);
  expect(blocked).toEqual([]);
  // nothing to download, and how to start one
  await expect(page.getByTestId("inspect-download")).toHaveCount(0);
  await expect(page.getByTestId("sample-start").getByRole("link", { name: "前往我的裝置" })).toHaveAttribute("href", "/devices/");
  await expect(page.getByTestId("sample-start").getByRole("link", { name: "檢測會蒐集哪些資料、如何處理" })).toHaveAttribute("href", "/privacy/#inspection");
  expect(asked).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("the other case: stalkerware every night, a known threat with the steps to take", async ({ page }) => {
  await signedOut(page);
  await page.goto("/sample-report/");
  // opened directly, the prerendered page is hydrated: it was drawn on the build machine's clock (UTC in CI), and the
  // report is drawn again on the reader's. The first day is 1 November in Taipei, with 18 hours connected.
  await expect(page.locator(".cover__fill")).toHaveCount(7);
  await expect(page.locator(".cover__fill").first()).toHaveClass(/cover__fill--h18\b/);
  await expect(page.locator(".inspect-table tbody tr").first()).toContainText("11/01");
  await page.getByTestId("sample-case-threat").click();
  await expect(page.getByTestId("sample-case-threat")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("sample-case-check")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("sample-case-body")).toContainText("每天半夜連往同一個伺服器");
  await expect(page.getByTestId("inspect-verdict")).toHaveAttribute("data-state", "threat");
  await expect(page.getByTestId("inspect-verdict").getByRole("heading", { name: "接下來可以做" })).toBeVisible();
  await expect(page.getByTestId("inspect-hit").filter({ hasText: "sync-collector.example" }).getByTestId("inspect-hit-blocked")).toHaveText("Vessel 沒有擋下");
  await expect(page.getByTestId("inspect-timers").locator("summary")).toHaveText("有 2 個目的地定時連線（約每 15 分鐘）");
  await expect(page.getByTestId("sample-mark")).toHaveCount(4);
  // the marked hours: at night, when the phone should be asleep
  await expect(page.locator(".inspect-report .tile--threat").first()).toBeVisible();
});

test("in English, and from the group page, the questions and the consent pages", async ({ page }) => {
  await signedOut(page);
  await page.goto("/en/sample-report/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sample inspection report");
  await expect(page.getByTestId("sample-mark").first()).toHaveText("Sample data");
  await page.goto("/for-groups/");
  await expect(page.locator(".gi-hero").getByRole("link", { name: "看檢測報告範例" })).toHaveAttribute("href", "/sample-report/");
  await page.goto("/faq/#q-anomaly");
  await expect(page.locator("#q-anomaly a")).toHaveAttribute("href", "/sample-report/");
  await page.goto("/");
  await expect(page.locator("footer").getByRole("link", { name: "檢測報告範例" })).toHaveAttribute("href", "/sample-report/");
});
