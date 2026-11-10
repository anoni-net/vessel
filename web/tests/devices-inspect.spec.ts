import { type Page, expect, test } from "@playwright/test";

// A device's inspection on the devices page: a badge beside its state, and a line under its spec sheet with what to do
// next. Where the inspection stands and its dates only, never what the report found (toomore/anoni-net-ws#461).

const NOW = new Date("2026-11-10T04:00:00Z");
const ME = { created_on: "2026-10-27", last_login_on: "2026-11-05", device_limit: 4, monthly_quota_bytes: 50e9, used_bytes: 9e9, group: null };
const BASE = { region: "jp", dns_filter: "malware", status: "active", created_on: "2026-11-01", expires_on: "2026-12-04", used_bytes: 2e9,
  blocked: 4, connected: true, ipv6: true, moved_until: null, relay: null,
  inspection: null, inspection_ends_at: null, inspection_days: null, inspection_report_until: null };
const CONFIRMING = { ...BASE, id: "d-a", name: "手機 A", inspection: "confirming", inspection_days: 7, inspection_confirm_minutes: 30 };
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

for (const [device, state, detail, name] of [
  [CONFIRMING, "檢測待確認", null, "檢測待確認，「手機 A」"],
  [ACTIVE, "檢測中", "第 3 天，共 7 天", "檢測中，第 3 天，共 7 天，「筆電 B」"],
  [ENDING, "檢測結束中", null, "檢測結束中，「平板 E」"],
  [ENDED, "檢測報告", "保存到 2026/11/15", "檢測報告，保存到 2026/11/15，「平板 C」"],
] as const) {
  test(`the card's corner says where the inspection stands: ${device.inspection}`, async ({ page }) => {
    await backend(page, [device]);
    await page.goto("/devices/");
    const c = card(page, device.name);
    // one link, where "檢測流量" is otherwise, on the row of the delete button
    const link = c.getByTestId("device-inspect");
    await expect(link).toHaveCount(1);
    await expect(c.locator(".device-foot > a")).toHaveCount(1);
    await expect(link).toHaveAttribute("href", `/devices/inspect/?d=${device.id}`);
    await expect(link).toHaveAttribute("data-state", device.inspection);
    await expect(link.locator(".foot-inspect__line > span").first()).toHaveText(state);
    if (detail) await expect(link.getByTestId("inspect-detail")).toHaveText(detail);
    else await expect(link.getByTestId("inspect-detail")).toHaveCount(0);
    // named for its device, starting with the shown words (WCAG 2.5.3); the mark before them is not read
    await expect(c.getByRole("link", { name, exact: true })).toHaveCount(1);
    await expect(link.locator(".inspect-mark")).toHaveAttribute("aria-hidden", "true");
    await expect(link.locator(`.inspect-mark--${device.inspection}`)).toHaveCount(1);
    // no badge beside the device's state any more
    await expect(c.locator(".device-head .badge")).toHaveCount(1);
    await expect(c.locator(".device-head .badge")).toHaveText("使用中");
    // the note in the card only while it waits for the device
    await expect(c.getByTestId("inspect-note")).toHaveCount(device.inspection === "confirming" ? 1 : 0);
  });
}

test("waiting for the device, the card has a note with the link's time and a way on", async ({ page }) => {
  await backend(page, [{ ...CONFIRMING, inspection_confirm_minutes: 20 }]);
  await page.goto("/devices/");
  const note = page.getByTestId("inspect-note");
  await expect(note).toHaveClass(/card--warn/);
  // the minutes the backend sends, not a number of the page's own
  await expect(note.locator("span")).toHaveText("請在這台裝置上打開檢測的確認連結，連結產生後 20 分鐘內有效。");
  await expect(note.getByRole("link", { name: "繼續「手機 A」的檢測", exact: true })).toHaveAttribute("href", "/devices/inspect/?d=d-a");
  // under the spec sheet
  const spec = (await page.locator(".spec").boundingBox())!;
  expect((await note.boundingBox())!.y).toBeGreaterThan(spec.y + spec.height - 1);
});

test("a backend without the link's time: the note says 30 minutes", async ({ page }) => {
  const { inspection_confirm_minutes: _, ...older } = CONFIRMING;
  await backend(page, [older]);
  await page.goto("/devices/");
  await expect(page.getByTestId("inspect-note").locator("span")).toContainText("30 分鐘內有效");
});

test("the marks differ in shape, not only in colour, in both schemes", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.unrouteAll();
    await backend(page, [CONFIRMING, ACTIVE, ENDING, ENDED]);
    await page.goto("/devices/");
    const mark = (state: string) => page.locator(`.inspect-mark--${state}`).evaluate((e) => {
      const s = getComputedStyle(e);
      return { bg: s.backgroundColor, image: s.backgroundImage, radius: s.borderTopLeftRadius, ink: getComputedStyle(e.closest("a")!).color };
    });
    const [active, waiting, ending, ended] = await Promise.all(["active", "confirming", "ending", "ended"].map(mark));
    // running: filled with the link's own colour; waiting and the report: empty; wrapping up: half filled
    expect(active.bg).toBe(active.ink);
    expect(waiting.bg).toBe("rgba(0, 0, 0, 0)");
    expect(ended.bg).toBe("rgba(0, 0, 0, 0)");
    expect(ending.image).toContain("linear-gradient");
    expect(ended.radius).not.toBe(active.radius);
  }
});

test("on a narrow phone the date goes under the state and the delete button stays on the right", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await backend(page, [ENDED]);
  await page.goto("/en/devices/");
  const link = page.getByTestId("device-inspect");
  const del = page.getByRole("button", { name: "Delete “平板 C”" });
  const [state, detail, button, foot] = await Promise.all([
    link.locator(".foot-inspect__line > span").first().boundingBox(), link.getByTestId("inspect-detail").boundingBox(),
    del.boundingBox(), page.locator(".device-foot").boundingBox(),
  ]);
  expect(detail!.y).toBeGreaterThan(state!.y + 5);
  expect(button!.x + button!.width).toBeGreaterThan(foot!.x + foot!.width - 2);
  expect(button!.y).toBeLessThan(state!.y + state!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("without an inspection the card links to start one, named for its device", async ({ page }) => {
  await backend(page, [NONE, { ...NONE, id: "d-f", name: "手機 F" }]);
  await page.goto("/devices/");
  const c = card(page, "桌機 D");
  await expect(c.getByTestId("inspect-note")).toHaveCount(0);
  // two links shown as the same words, told apart by name (WCAG 2.5.3: the name starts with them)
  await expect(page.getByRole("link", { name: "檢測流量「桌機 D」" })).toHaveText("檢測流量");
  await expect(page.getByRole("link", { name: "檢測流量「手機 F」" })).toHaveAttribute("href", "/devices/inspect/?d=d-f");
});

test("the card says nothing of what the report found", async ({ page }) => {
  // a portal that sent more than it should still has the page show only where the inspection stands
  await backend(page, [{ ...ENDED, report: { epk: "e", iv: "i", ct: "c" }, verdict: "threat", findings: ["stalkerware"] }, ACTIVE]);
  await page.goto("/devices/");
  await expect(page.getByTestId("device-inspect")).toHaveCount(2);
  const text = await page.locator("main").innerText();
  for (const words of ["需要檢查", "需要留意", "已知威脅", "威脅", "跟蹤", "可疑", "沒有發現", "stalkerware", "threat"]) expect(text).not.toContain(words);
});

test("the card and the inspection's page count the same day", async ({ page }) => {
  for (const [hours, day] of [[7 * 24 - 1, 1], [5 * 24, 3], [4.5 * 24, 3], [30, 6], [2, 7]] as const) {
    const ends = new Date(NOW.getTime() + hours * 3_600_000).toISOString();
    await page.unrouteAll();
    await backend(page, [{ ...ACTIVE, id: "d-1", inspection_ends_at: ends }], { consent_version: "x", days: 7, report_days: 7, status: "active", ends_at: ends, started_at: NOW.toISOString() });
    await page.goto("/devices/");
    await expect(page.getByTestId("inspect-detail")).toHaveText(`第 ${day} 天，共 7 天`);
    await page.goto("/devices/inspect/?d=d-1");
    await expect(page.getByTestId("inspect-status")).toContainText(`檢測中，第 ${day} 天，共 7 天`);
  }
});

test("in English the links name their device too", async ({ page }) => {
  await backend(page, [CONFIRMING, ACTIVE, ENDING, ENDED, NONE]);
  await page.goto("/en/devices/");
  for (const [name, shown] of [
    ["Continue the inspection of “手機 A”", "Continue"], ["Inspection pending, for “手機 A”", "Inspection pending"],
    ["Inspecting, day 3 of 7, for “筆電 B”", "Inspectingday 3 of 7"], ["Inspection ending, for “平板 E”", "Inspection ending"],
    ["Inspection report, kept until 11/15/2026, for “平板 C”", "Inspection reportkept until 11/15/2026"],
    ["Inspect traffic on “桌機 D”", "Inspect traffic"],
  // the dot between the state and its date is drawn by CSS, so it is not in the text
  ]) await expect(page.getByRole("link", { name, exact: true })).toHaveText(shown);
});

test("a device slowed down for the month keeps its inspection, and can start one", async ({ page }) => {
  // over the quota a device stays active at a low speed (anoni-net/vessel#254); the backend lets an active device start
  await backend(page, [{ ...ACTIVE, throttled: true }, { ...NONE, throttled: true }]);
  await page.goto("/devices/");
  const running = card(page, "筆電 B");
  await expect(running.getByTestId("throttled")).toBeVisible();
  await expect(running.getByTestId("device-inspect")).toHaveAttribute("data-state", "active");
  await expect(running.getByTestId("inspect-detail")).toHaveText("第 3 天，共 7 天");
  const idle = card(page, "桌機 D");
  await expect(idle.getByTestId("throttled")).toBeVisible();
  await expect(idle.getByRole("link", { name: "檢測流量「桌機 D」" })).toHaveText("檢測流量");
});
