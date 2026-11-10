import { type Page, expect, test } from "@playwright/test";

// A device's inspection on the devices page: a badge beside its state, and a line under its spec sheet with what to do
// next. Where the inspection stands and its dates only, never what the report found (toomore/anoni-net-ws#461).

const NOW = new Date("2026-11-10T04:00:00Z");
const ME = { created_on: "2026-10-27", last_login_on: "2026-11-05", device_limit: 4, monthly_quota_bytes: 50e9, used_bytes: 9e9, group: null };
const BASE = { region: "jp", dns_filter: "malware", status: "active", created_on: "2026-11-01", expires_on: "2026-12-04", used_bytes: 2e9,
  blocked: 4, connected: true, ipv6: true, moved_until: null, relay: null,
  inspection: null, inspection_ends_at: null, inspection_days: null, inspection_report_until: null };
const CONFIRMING = { ...BASE, id: "d-a", name: "手機 A", inspection: "confirming", inspection_days: 7 };
const ACTIVE = { ...BASE, id: "d-b", name: "筆電 B", inspection: "active", inspection_days: 7,
  inspection_ends_at: new Date(NOW.getTime() + 4.5 * 86_400_000).toISOString() };
const ENDING = { ...BASE, id: "d-e", name: "平板 E", inspection: "ending", inspection_days: 7, inspection_ends_at: "2026-11-09T04:00:00Z" };
const ENDED = { ...BASE, id: "d-c", name: "平板 C", inspection: "ended", inspection_days: 7, inspection_ends_at: "2026-11-08T04:00:00Z",
  inspection_report_until: "2026-11-15" };
const NONE = { ...BASE, id: "d-d", name: "桌機 D" };

test.use({ timezoneId: "Asia/Taipei" });

async function backend(page: Page, devices: object[], inspection?: object) {
  await page.clock.install({ time: NOW });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: ME });
    if (path === "/api/devices") return route.fulfill({ json: devices });
    if (inspection && path.endsWith("/inspection")) return route.fulfill({ json: inspection });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}

const card = (page: Page, name: string) => page.getByTestId("device").filter({ has: page.getByRole("heading", { name }) });

for (const [device, badge, words, go, goName] of [
  [CONFIRMING, "檢測待確認", "請在這台裝置上打開檢測的確認連結，連結產生後 30 分鐘內有效。", "繼續", "繼續「手機 A」的檢測"],
  [ACTIVE, "檢測中", "檢測第 3 天，共 7 天，2026/11/15 結束。", "查看目前的結果", "查看目前的結果「筆電 B」"],
  [ENDING, "檢測結束中", "正在整理檢測報告，大約 5 分鐘。", null, null],
  [ENDED, "檢測已結束", "檢測報告保存到 2026/11/15，請記得下載。", "查看報告", "查看報告「平板 C」"],
] as const) {
  test(`the card says where the inspection stands: ${device.inspection}`, async ({ page }) => {
    await backend(page, [device]);
    await page.goto("/devices/");
    const c = card(page, device.name);
    await expect(c.getByTestId("inspect-badge")).toHaveText(badge);
    // beside the device's own state, in the same corner
    await expect(c.locator(".device-head__badges .badge")).toHaveText(["使用中", badge]);
    const note = c.getByTestId("inspect-note");
    await expect(note).toHaveAttribute("data-state", device.inspection);
    await expect(note.locator("span")).toHaveText(words);
    // under the spec sheet
    const spec = (await c.locator(".spec").boundingBox())!;
    expect((await note.boundingBox())!.y).toBeGreaterThan(spec.y + spec.height - 1);
    const links = c.getByTestId("device-inspect");
    if (go === null) {
      await expect(links).toHaveCount(0);
    } else {
      // one link to the inspection, in the line and not again at the bottom of the card
      await expect(links).toHaveCount(1);
      await expect(note.getByRole("link", { name: goName, exact: true })).toHaveText(go);
      await expect(links).toHaveAttribute("href", `/devices/inspect/?d=${device.id}`);
      await expect(c.locator(".device-foot a")).toHaveCount(0);
    }
  });
}

test("the line's colour: orange while it waits for the person, pale blue while it runs, plain once it has ended", async ({ page }) => {
  await backend(page, [CONFIRMING, ACTIVE, ENDING, ENDED]);
  await page.goto("/devices/");
  const look = (name: string) => card(page, name).getByTestId("inspect-note").getAttribute("class");
  expect(await look("手機 A")).toContain("card--warn");
  expect(await look("筆電 B")).toContain("card--tint");
  expect(await look("平板 E")).toContain("card--tint");
  expect(await look("平板 C")).not.toMatch(/card--(warn|tint)/);
  // the badge is a state, not a warning: the same blue outline as the others, on the card's paper
  const badge = card(page, "手機 A").getByTestId("inspect-badge");
  const [border, ink] = await badge.evaluate((e) => [getComputedStyle(e).borderTopColor, getComputedStyle(e).color]);
  expect(border).toBe(ink);
  expect(border).toBe("rgb(11, 60, 168)");
});

test("without an inspection the card links to start one, named for its device", async ({ page }) => {
  await backend(page, [NONE, { ...NONE, id: "d-f", name: "手機 F" }]);
  await page.goto("/devices/");
  const c = card(page, "桌機 D");
  await expect(c.getByTestId("inspect-badge")).toHaveCount(0);
  await expect(c.getByTestId("inspect-note")).toHaveCount(0);
  // two links shown as the same words, told apart by name (WCAG 2.5.3: the name starts with them)
  await expect(page.getByRole("link", { name: "檢測流量「桌機 D」" })).toHaveText("檢測流量");
  await expect(page.getByRole("link", { name: "檢測流量「手機 F」" })).toHaveAttribute("href", "/devices/inspect/?d=d-f");
});

test("the card says nothing of what the report found", async ({ page }) => {
  // a portal that sent more than it should still has the page show only where the inspection stands
  await backend(page, [{ ...ENDED, report: { epk: "e", iv: "i", ct: "c" }, verdict: "threat", findings: ["stalkerware"] }, ACTIVE]);
  await page.goto("/devices/");
  await expect(page.getByTestId("inspect-note")).toHaveCount(2);
  const text = await page.locator("main").innerText();
  for (const words of ["需要檢查", "需要留意", "已知威脅", "威脅", "跟蹤", "可疑", "沒有發現", "stalkerware", "threat"]) expect(text).not.toContain(words);
});

test("the card and the inspection's page count the same day", async ({ page }) => {
  for (const [hours, day] of [[7 * 24 - 1, 1], [5 * 24, 3], [4.5 * 24, 3], [30, 6], [2, 7]] as const) {
    const ends = new Date(NOW.getTime() + hours * 3_600_000).toISOString();
    await page.unrouteAll();
    await backend(page, [{ ...ACTIVE, id: "d-1", inspection_ends_at: ends }], { consent_version: "x", days: 7, report_days: 7, status: "active", ends_at: ends, started_at: NOW.toISOString() });
    await page.goto("/devices/");
    await expect(page.getByTestId("inspect-note").locator("span")).toContainText(`檢測第 ${day} 天，共 7 天`);
    await page.goto("/devices/inspect/?d=d-1");
    await expect(page.getByTestId("inspect-status")).toContainText(`檢測中，第 ${day} 天，共 7 天`);
  }
});

test("in English the links name their device too", async ({ page }) => {
  await backend(page, [CONFIRMING, ACTIVE, ENDED, NONE]);
  await page.goto("/en/devices/");
  for (const [name, shown] of [
    ["Continue the inspection of “手機 A”", "Continue"], ["See the results so far for “筆電 B”", "See the results so far"],
    ["See the report for “平板 C”", "See the report"], ["Inspect traffic on “桌機 D”", "Inspect traffic"],
  ]) await expect(page.getByRole("link", { name, exact: true })).toHaveText(shown);
  await expect(card(page, "筆電 B").getByTestId("inspect-note")).toContainText("Inspection day 3 of 7, ends on");
});
