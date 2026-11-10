import { type Page, expect, test } from "@playwright/test";
import {
  CLEAN_REPORT, FULL_REPORT, KEY, MANY_REPORT, ONCE_ADS_REPORT, ONCE_LISTS_REPORT, ONCE_REPORT, ONCE_START, ONE_DAY_ADS_REPORT, THREAT_ADS_REPORT, THREAT_APP_REPORT,
  THREAT_APPS_REPORT, THREAT_REPORT, WEEK_ADS_REPORT, WEEK_REPORT, WEEK_START, seal,
} from "./inspect-fixtures.ts";

// made with inspect/analyze.py's `seal`, so that the page and the analysis host are checked against each other
const SEALED = {"epk": "ignJt+ZZHZd1te0IIZaPaP1DfczxkdNt4JRP7PZoHzU=", "iv": "tWYNp+Nl//rdFBJU", "ct": "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"};
const EMPTY = {"epk": "zfutepUU1oqOAiOcmy3+S5Mmgo0YExpXJSmFI/Jf5Bc=", "iv": "neXX7R+dUI7MrKg8", "ct": "/Qd2Z+oagYZXNn47VLyCVi6XpD2/80NCbtvJdu6x6g=="};
const OTHER_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

const ID = "d-1";
const ME = { created_on: "2026-10-27", last_login_on: "2026-11-05", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 0, group: null };
const DEVICE = { id: ID, name: "我的手機", region: "sg", dns_filter: "none", status: "active", created_on: "2026-10-27", expires_on: "2030-01-01",
  used_bytes: 0, blocked: 0, connected: true, moved_until: null, ipv6: true, relay: null, inspection: null };
const BASE = { consent_version: "2026-11-09", days: 7, report_days: 7 };
const URL_ = "https://confirm.vessel.anoni.net/c/ABCDEFGHJKLMNPQR";
const URL_NEW = "https://confirm.vessel.anoni.net/c/NEWCODEABCDEFGHJ";

type Sent = { method: string; body: unknown };

async function backend(page: Page, inspection: object, opts: { me?: object; postError?: string; after?: object; renewed?: object | "expired" } = {}) {
  const sent: Sent[] = [];
  let current = inspection;
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.endsWith("/inspection/code")) {
      sent.push({ method: "RENEW", body: null });
      if (opts.renewed === "expired") {
        current = { ...BASE, status: "none" };
        return json({ error: "inspection_expired" }, 409);
      }
      if (opts.renewed) current = opts.renewed;
      return json({ code: "NEWCODEABCDEFGHJ", url: URL_NEW, minutes: 30 });
    }
    if (path.endsWith("/inspection")) {
      if (req.method() !== "GET") {
        sent.push({ method: req.method(), body: req.postData() ? req.postDataJSON() : null });
        if (opts.postError) return json({ error: opts.postError }, 503);
        if (opts.after) current = opts.after;
        return json(req.method() === "POST" ? { code: "ABCDEFGHJKLMNPQR", url: URL_, minutes: 30 } : { ok: true });
      }
      return json(current);
    }
    if (path === "/api/me") return json({ ...ME, ...opts.me });
    if (path === "/api/devices") return json([DEVICE]);
    return json({});
  });
  return sent;
}

/** Presses the download button and reads what it saves. */
async function downloaded(page: Page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("inspect-download").click()]);
  const chunks: Buffer[] = [];
  for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
  return { name: download.suggestedFilename(), html: Buffer.concat(chunks).toString() };
}

const goto = (page: Page) => page.goto(`/devices/inspect/?d=${ID}`);
const withKey = (page: Page, key = KEY) =>
  page.addInitScript(([id, k]) => localStorage.setItem(`vessel-inspection:${id}`, JSON.stringify({ key: k })), [ID, key]);

test("says what is collected and needs agreement before it starts", async ({ page }) => {
  const sent = await backend(page, { ...BASE, status: "none" }, { after: { ...BASE, status: "confirming" } });
  await goto(page);
  const form = page.getByTestId("inspect-consent");
  await expect(form).toContainText("匿名網路社群 anoni.net");
  await expect(form).toContainText("日本東京");
  await expect(form).toContainText("7 天");
  await expect(form).toContainText("不安全");
  await expect(form.getByRole("button", { name: "同意並開始" })).toBeDisabled();
  await page.getByTestId("inspect-agree").check();
  await form.getByRole("button", { name: "同意並開始" }).click();
  await expect(page.getByTestId("inspect-url")).toHaveAttribute("href", URL_);
  const body = sent[0].body as { consent_version: string; public_key: string };
  expect(body.consent_version).toBe("2026-11-09");
  expect(body.public_key).toMatch(/^[A-Za-z0-9+\/]{43}=$/);
  // the private key stays here: on screen to save, and never in what was sent
  const key = await page.getByTestId("inspect-key").locator("code").textContent();
  expect(key).toMatch(/^[A-Za-z0-9+\/]{43}=$/);
  expect(JSON.stringify(sent)).not.toContain(key!);
});

test("the page keeps its shape while it loads, and nothing jumps when the data arrives", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { shifts: number[] }).shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number }[]) (window as unknown as { shifts: number[] }).shifts.push(e.value);
    }).observe({ type: "layout-shift", buffered: true });
  });
  await backend(page, { ...BASE, status: "none" });
  await page.route("**/api/devices/*/inspection", async (route) => {
    await new Promise((done) => setTimeout(done, 700));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...BASE, status: "none" }) });
  });
  await goto(page);
  await expect(page.locator('main [aria-busy="true"]')).toBeVisible();
  await expect(page.getByTestId("inspect-consent")).toBeVisible();
  await expect(page.getByText("檢測的裝置：我的手機")).toBeVisible();
  await page.waitForTimeout(200);
  const shifts = await page.evaluate(() => (window as unknown as { shifts: number[] }).shifts);
  expect(Math.max(0, ...shifts)).toBeLessThan(0.05);
});

test("with the key here, the page never asks for it while the report opens", async ({ page }) => {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="inspect-locked"]')) (window as unknown as { asked: boolean }).asked = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await backend(page, ended);
  await withKey(page);
  await goto(page);
  await expect(page.getByTestId("inspect-report")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { asked?: boolean }).asked ?? false)).toBe(false);
});

test("a group's person is told the leaders do not see it", async ({ page }) => {
  await backend(page, { ...BASE, status: "none" }, { me: { group: { role: "member", label: "A1", device_revoked_on: null } } });
  await goto(page);
  await expect(page.getByTestId("inspect-group")).toBeVisible();
});

test("says so when the service is not available", async ({ page }) => {
  await backend(page, { ...BASE, status: "none" }, { postError: "inspection_unavailable" });
  await goto(page);
  await page.getByTestId("inspect-agree").check();
  await page.getByRole("button", { name: "同意並開始" }).click();
  await expect(page.getByRole("alert")).toContainText("目前無法使用");
});

test("the link is gone in another browser, and it can be cancelled", async ({ page }) => {
  const sent = await backend(page, { ...BASE, status: "confirming" }, { after: { ...BASE, status: "none" } });
  await goto(page);
  await expect(page.getByTestId("inspect-lost")).toBeVisible();
  await page.getByRole("button", { name: "取消這次檢測" }).click();
  await expect(page.getByTestId("inspect-consent")).toBeVisible();
  expect(sent).toEqual([{ method: "DELETE", body: null }]);
});

const ended = { ...BASE, status: "ended", report: SEALED, report_until: "2026-11-18", started_at: "2026-11-09T00:00:00Z", ends_at: "2026-11-11T00:00:00Z" };

test("opens a report sealed by the analysis host, with a reminder to download it", async ({ page }) => {
  await backend(page, ended);
  await withKey(page);
  await goto(page);
  await expect(page.getByTestId("inspect-until")).toContainText("請記得下載");
  const report = page.getByTestId("inspect-report");
  await expect(report).toContainText("tracker.example");
  await expect(report).toContainText("跟蹤軟體");
  // a report from before the names that could not be found were left out: they stay out of the page
  await expect(report).not.toContainText("gone.example");
  await expect(page.getByTestId("inspect-tiles").locator(".tile--threat")).toHaveCount(2);
  await expect(page.getByTestId("inspect-tiles").locator(".tile--check")).toHaveCount(1);
  // a mark also has a sign, for whoever cannot tell the colours apart
  await expect(page.getByTestId("inspect-tiles").locator(".tile--check")).toHaveText("!");
  const { name, html } = await downloaded(page);
  // the full report keeps the name and the title it had before there was a download of the results so far
  expect(name).toMatch(/^vessel-inspection-\d{4}-\d{2}-\d{2}\.html$/);
  expect(html).toContain("tracker.example");
  expect(html).toContain("<style>");
  expect(html).toContain("<title>裝置流量檢測</title>");
  expect(html).not.toContain("gone.example");
  expect(html).not.toContain("進行中");
  expect(html).not.toContain("data-partial");
  expect(html).not.toContain(KEY);
});

const big = (findings: object[], extra: object = {}) => ({
  ...ended,
  report: seal({
    first: 1762128000, last: 1762214400, hours: [{ hour: "2026-11-09T01", up: 1000, down: 2000, mark: "x" }], coverage: { active_hours: 1, total_hours: 1 },
    dns: { total: 100, nx_share: 0, ads_share: 0 }, idle_share: 0, checks: [{ id: "stalkerware", count: 7 }, { id: "cti", count: 5000 }], findings, ...extra,
  }),
});
const site = (kind: string, severity: string, i: number) => ({ severity, kind, name: `s${i}.example`, how: "DNS", count: 5000 - i, first: 1762128000 });
const threatsAndMany = (n: number) => [site("stalkerware", "threat", 0), site("stalkerware", "threat", 1), ...Array.from({ length: n }, (_, i) => site("cti", "check", i + 2))];

test("a report full of sites still says first what was found and what to do", async ({ page }) => {
  // stored before the analysis host listed only the top ones
  await backend(page, big(threatsAndMany(2000)));
  await withKey(page);
  await goto(page);
  const summary = page.getByTestId("inspect-summary");
  await expect(summary).toContainText("2 個網站，共 7 次");
  await expect(summary).toContainText("2,000 個網站，共 5,000 次");
  const [threats, others] = [page.getByTestId("inspect-group").nth(0), page.getByTestId("inspect-group").nth(1)];
  await expect(threats).toHaveJSProperty("open", true);
  await expect(others).toHaveJSProperty("open", false);
  await expect(others.getByTestId("inspect-finding")).toHaveCount(30);
  await expect(others.getByTestId("inspect-not-listed")).toContainText("另有 1,970 個網站");
  // what to do is on the first screens, ahead of the list and of the hours
  const next = page.getByRole("heading", { name: "接下來可以做" });
  const [at, list, tiles] = await Promise.all([next.boundingBox(), page.getByTestId("inspect-group").first().boundingBox(), page.getByTestId("inspect-tiles").boundingBox()]);
  expect(at!.y).toBeLessThan(page.viewportSize()!.height * 1.5);
  expect(at!.y).toBeLessThan(list!.y);
  expect(list!.y).toBeLessThan(tiles!.y);
  // the download has the closed groups open
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("inspect-download").click()]);
  const chunks: Buffer[] = [];
  for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
  const html = Buffer.concat(chunks).toString();
  expect(html).toContain("s31.example");
  expect(html).not.toContain("s32.example");
  expect(html.match(/<details[^>]*inspect-group[^>]*>/g)!.every((tag) => /\bopen\b/.test(tag))).toBe(true);
});

test("the sites a report leaves out are counted", async ({ page }) => {
  await backend(page, big(threatsAndMany(30), { more: { cti: 12 } }));
  await withKey(page);
  await goto(page);
  await expect(page.getByTestId("inspect-summary")).toContainText("42 個網站");
  await expect(page.getByTestId("inspect-group").nth(1).getByTestId("inspect-not-listed")).toContainText("另有 12 個網站");
});

test("something found without a site has a line and no list", async ({ page }) => {
  await backend(page, big([{ severity: "check", kind: "bypass_dns", count: 9 }]));
  await withKey(page);
  await goto(page);
  await expect(page.getByTestId("inspect-summary")).toContainText("9 次");
  await expect(page.getByTestId("inspect-group")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "接下來可以做" })).toHaveCount(0);
});

test("without the key it asks for it, and rejects a wrong one", async ({ page }) => {
  await backend(page, ended);
  await goto(page);
  await expect(page.getByTestId("inspect-locked")).toBeVisible();
  await page.getByTestId("inspect-key-input").fill(OTHER_KEY);
  await page.getByRole("button", { name: "打開報告" }).click();
  await expect(page.getByRole("alert")).toContainText("鑰匙不符");
  await page.getByTestId("inspect-key-input").fill(KEY);
  await page.getByRole("button", { name: "打開報告" }).click();
  await expect(page.getByTestId("inspect-report")).toBeVisible();
});

test("a running inspection shows the end date and the results so far, and can be ended", async ({ page }) => {
  const sent = await backend(page, { ...BASE, status: "active", report: SEALED, ends_at: "2026-11-16T00:00:00Z" }, { after: { ...BASE, status: "ending" } });
  await withKey(page);
  await goto(page);
  await expect(page.getByTestId("inspect-status")).toContainText("自動結束");
  await expect(page.getByTestId("inspect-report")).toBeVisible();
  // readable at any time, and it says how far behind it is, below the report
  await expect(page.getByTestId("inspect-delay")).toContainText("延遲 30 分鐘，最久約 1 小時");
  const [report, delay] = await Promise.all([page.getByTestId("inspect-report").boundingBox(), page.getByTestId("inspect-delay").boundingBox()]);
  expect(delay!.y).toBeGreaterThan(report!.y + report!.height - 1);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "提早結束" }).click();
  await expect(page.getByText("正在結束檢測")).toBeVisible();
  expect(sent).toEqual([{ method: "DELETE", body: null }]);
});

test("a running inspection says how far along it is in one small card, with ending it as a link", async ({ page }) => {
  const ends = new Date(Date.now() + 4.5 * 86_400_000).toISOString();
  await backend(page, { ...BASE, status: "active", report: SEALED, ends_at: ends });
  await withKey(page);
  await goto(page);
  const status = page.getByTestId("inspect-status");
  await expect(status).toContainText("第 3 天，共 7 天");
  await expect(status).toContainText("自動結束");
  await expect(status.getByRole("button", { name: "提早結束" })).toHaveClass("link-button");
  await expect(page.getByTestId("inspect-running").locator(".nb-button")).toHaveCount(1); // the key's copy button
  const [card, report] = await Promise.all([status.boundingBox(), page.getByTestId("inspect-report").boundingBox()]);
  expect(card!.y + card!.height).toBeLessThanOrEqual(report!.y);
  expect(card!.height).toBeLessThan(120);
});

test("a running inspection's results so far can be downloaded, from a link below the report", async ({ page }) => {
  const ends = new Date(Date.now() + 4.5 * 86_400_000).toISOString();
  await backend(page, { ...BASE, status: "active", report: SEALED, ends_at: ends });
  await withKey(page);
  await goto(page);
  const link = page.getByTestId("inspect-download");
  await expect(link).toHaveText("下載目前的結果");
  // no louder than ending it early: a link like that one, under the report and the words on how far behind it is
  await expect(link).toHaveClass("link-button");
  const [report, delay, box] = await Promise.all([page.getByTestId("inspect-report").boundingBox(), page.getByTestId("inspect-delay").boundingBox(), link.boundingBox()]);
  expect(box!.y).toBeGreaterThanOrEqual(delay!.y + delay!.height - 1);
  expect(box!.y).toBeGreaterThan(report!.y + report!.height - 1);

  const before = Date.now();
  const { name, html } = await downloaded(page);
  // marked as in progress in its name, its title and its first lines, with the time it was made and how far behind it is
  expect(name).toMatch(/^vessel-inspection-\d{4}-\d{2}-\d{2}-\d{4}-in-progress\.html$/);
  expect(name).toContain(new Date(before).toLocaleDateString("sv"));
  expect(html).toContain("<title>裝置流量檢測（進行中）</title>");
  expect(html).toContain("<h1>裝置流量檢測（進行中）</h1>");
  expect(html).toMatch(/檢測進行中，結果產生於 \d{4}\/\d{2}\/\d{2} \d{2}:\d{2} UTC[+-]\d+(:\d{2})?（第 3 天，共 7 天）/);
  expect(html).toContain("延遲 30 分鐘，最久約 1 小時");
  expect(html).toContain("檢測結束後可以下載完整報告");
  // what a report cannot tell: beside the key on the page, once, and at the report's end in the file
  await expect(page.getByText("報告只涵蓋檢測期間的連線")).toHaveCount(1);
  expect(html.match(/報告只涵蓋檢測期間的連線/g)).toHaveLength(1);
  expect(html).toContain("我的手機");
  expect(html).toContain("tracker.example");
  expect(html).not.toContain(KEY);
  // the words for the page and the link stay on the page
  expect(html).not.toContain("下載目前的結果");
});

test("in English, the results so far say they are in progress too", async ({ page }) => {
  await backend(page, { ...BASE, status: "active", report: SEALED, ends_at: "2026-11-16T00:00:00Z" });
  await withKey(page);
  await page.goto(`/en/devices/inspect/?d=${ID}`);
  await expect(page.getByTestId("inspect-download")).toHaveText("Download results so far");
  const { name, html } = await downloaded(page);
  expect(name).toMatch(/-in-progress\.html$/);
  expect(html).toContain("<title>Device traffic inspection (in progress)</title>");
  expect(html).toContain("Inspection in progress. Results as of ");
  expect(html).toContain("about 30 minutes behind");
});

test("a device with nothing recorded says so", async ({ page }) => {
  await backend(page, { ...ended, report: EMPTY });
  await withKey(page);
  await goto(page);
  await expect(page.getByTestId("inspect-empty")).toBeVisible();
});

test("the key is forgotten once the report is gone", async ({ page }) => {
  await backend(page, { ...BASE, status: "none" });
  await page.goto("/");
  await page.evaluate(([id, k]) => localStorage.setItem(`vessel-inspection:${id}`, JSON.stringify({ key: k })), [ID, KEY]);
  await goto(page);
  await expect(page.getByTestId("inspect-consent")).toBeVisible();
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`vessel-inspection:${id}`), ID)).toBeNull();
});

// a backend from before the inspection's dates were in the device list sends its state alone: the card says the state
// without them, and the note waiting for the device takes the link's time as 30 minutes
for (const [status, words, note] of [
  [null, "檢測流量", null], ["confirming", "檢測待確認", "請在這台裝置上打開檢測的確認連結，連結產生後 30 分鐘內有效。"],
  ["active", "檢測中", null], ["ending", "檢測結束中", null], ["ended", "檢測報告", null],
] as const) {
  test(`the device card links to it: ${status}`, async ({ page }) => {
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = path === "/api/me" ? ME : path === "/api/devices" ? [{ ...DEVICE, inspection: status }] : {};
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto("/devices/");
    const link = page.getByTestId("device-inspect");
    await expect(link).toHaveText(words);
    await expect(link).toHaveAttribute("href", `/devices/inspect/?d=${ID}`);
    if (note) await expect(page.getByTestId("inspect-note").locator("span")).toHaveText(note);
    else await expect(page.getByTestId("inspect-note")).toHaveCount(0);
  });
}

// WCAG 2.4.3 and 4.1.3: a new status replaces most of the page, the button just pressed included. What happened is said
// through the site's live region, and focus goes to the page's heading instead of falling back to the body.

const said = (page: Page) => page.locator("#announce");
const focused = (page: Page) => page.evaluate(() => {
  const e = document.activeElement;
  return !e || e === document.body ? "body" : `${e.tagName.toLowerCase()} ${e.textContent?.trim().slice(0, 20)}`;
});
const H1 = "h1 裝置流量檢測";

test("starting says the link is ready, and focus goes to the top", async ({ page }) => {
  await backend(page, { ...BASE, status: "none" }, { after: { ...BASE, status: "confirming", confirm_seconds: 1800 } });
  await goto(page);
  await page.getByTestId("inspect-agree").focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspect-url")).toBeVisible();
  await expect(said(page)).toHaveText("已產生確認連結，請在要檢測的裝置上打開。");
  await expect.poll(() => focused(page)).toBe(H1);
});

for (const [name, inspection, kept, button, after, words] of [
  ["cancelling", { ...BASE, status: "confirming", confirm_seconds: 1800 }, false, "取消這次檢測", { ...BASE, status: "none" }, "已取消這次檢測。"],
  ["ending", { ...BASE, status: "active", report: SEALED, ends_at: "2026-11-16T00:00:00Z" }, true, "提早結束", { ...BASE, status: "ending" }, "正在結束檢測、整理報告，通常 5 分鐘內完成。"],
  ["deleting", { ...BASE, status: "ended", report: SEALED, report_until: "2026-11-18" }, true, "現在刪除報告", { ...BASE, status: "none" }, "報告已刪除。"],
] as const) {
  test(`${name} says so, and focus goes to the top`, async ({ page }) => {
    await backend(page, inspection, { after });
    if (kept) await withKey(page);
    await goto(page);
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: button }).focus();
    await page.keyboard.press("Enter");
    await expect(said(page)).toHaveText(words);
    await expect.poll(() => focused(page)).toBe(H1);
    // a link ran out says something else: this was done here
    await expect(page.getByTestId("inspect-expired")).toHaveCount(0);
  });
}

test("a key that opens the report says so; a wrong one keeps focus in the field and points to the error", async ({ page }) => {
  await backend(page, ended);
  await goto(page);
  const field = page.getByTestId("inspect-key-input");
  await field.fill(OTHER_KEY);
  await field.press("Enter");
  await expect(page.getByRole("alert")).toContainText("鑰匙不符");
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription("鑰匙不符，請確認是這次檢測的鑰匙。");
  await field.fill(KEY);
  await field.press("Enter");
  await expect(page.getByTestId("inspect-report")).toBeVisible();
  await expect(said(page)).toHaveText("報告已打開。");
  await expect.poll(() => focused(page)).toBe(H1);
});

test("an error leaves the page as it was, to try again", async ({ page }) => {
  await backend(page, { ...BASE, status: "none" }, { postError: "inspection_unavailable" });
  await goto(page);
  await page.getByTestId("inspect-agree").check();
  await page.getByRole("button", { name: "同意並開始" }).click();
  await expect(page.getByRole("alert")).toContainText("目前無法使用");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("inspect-agree")).toBeChecked();
  await expect(page.getByRole("button", { name: "同意並開始" })).toBeEnabled();
  expect(await focused(page)).not.toBe("body");
});

test("the device confirming it, seen by the page on its own, is said too", async ({ page }) => {
  await page.clock.install();
  await backend(page, { ...BASE, status: "confirming", confirm_seconds: 1800 });
  await withKey(page);
  await goto(page);
  await page.getByRole("button", { name: "取消這次檢測" }).focus();
  await page.route("**/api/devices/*/inspection", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...BASE, status: "active", report: SEALED, ends_at: "2026-11-16T00:00:00Z" }) }));
  await page.clock.runFor(11_000);
  await expect(page.getByTestId("inspect-running")).toBeVisible();
  await page.clock.runFor(1000);
  await expect(said(page)).toHaveText("裝置已確認，檢測已經開始。");
  await expect.poll(() => focused(page)).toBe(H1);
});

// WCAG 2.2.1: the confirmation link is good for 30 minutes. Before it runs out the page says so, and one press makes a new one.

const waiting = (seconds: number) => ({ ...BASE, status: "confirming", confirm_seconds: seconds });
const withLink = (page: Page) =>
  page.addInitScript(([id, k, url]) => localStorage.setItem(`vessel-inspection:${id}`, JSON.stringify({ key: k, url, minutes: 30 })), [ID, KEY, URL_]);

test("with time to spare, there is no reminder", async ({ page }) => {
  await backend(page, waiting(301));
  await withLink(page);
  await goto(page);
  await expect(page.getByTestId("inspect-url")).toBeVisible();
  await expect(page.getByTestId("inspect-soon")).toHaveCount(0);
});

test("before the link runs out it says so, and one press makes a new one that replaces it", async ({ page }) => {
  const sent = await backend(page, waiting(200), { renewed: waiting(1800) });
  await withLink(page);
  await goto(page);
  const soon = page.getByTestId("inspect-soon");
  await expect(soon).toContainText("確認連結再 4 分鐘到期");
  await expect(said(page)).toHaveText(/確認連結再 4 分鐘到期/);
  await soon.getByRole("button", { name: "產生新的確認連結" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspect-url")).toHaveAttribute("href", URL_NEW);
  await expect(soon).toHaveCount(0);
  await expect(said(page)).toHaveText("已產生新的確認連結，舊的連結已經失效。");
  await expect.poll(() => focused(page)).toBe("h2 在這台裝置上確認");
  // the browser keeps the same key, with the new link
  const stored = await page.evaluate((id) => JSON.parse(localStorage.getItem(`vessel-inspection:${id}`)!), ID);
  expect(stored).toEqual({ key: KEY, url: URL_NEW, minutes: 30 });
  expect(sent.map((x) => x.method)).toEqual(["RENEW"]);
});

test("where the link is not kept, there is nothing to renew", async ({ page }) => {
  await backend(page, waiting(200));
  await goto(page);
  await expect(page.getByTestId("inspect-lost")).toBeVisible();
  await expect(page.getByTestId("inspect-soon")).toHaveCount(0);
});

test("a link that ran out meanwhile takes the page back to the start, saying why", async ({ page }) => {
  await backend(page, waiting(30), { renewed: "expired" });
  await withLink(page);
  await goto(page);
  await page.getByRole("button", { name: "產生新的確認連結" }).click();
  await expect(page.getByTestId("inspect-expired")).toContainText("上次的確認連結已經過期，沒有開始蒐集");
  await expect(page.getByTestId("inspect-consent")).toBeVisible();
  await expect(said(page)).toHaveText(/上次的確認連結已經過期/);
});

test("a link that runs out while the page is open is said, and the page starts over", async ({ page }) => {
  await page.clock.install();
  await backend(page, waiting(5));
  await withLink(page);
  await goto(page);
  await expect(page.getByTestId("inspect-soon")).toBeVisible();
  await page.route("**/api/devices/*/inspection", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...BASE, status: "none" }) }));
  await page.clock.runFor(11_000);
  await expect(page.getByTestId("inspect-expired")).toBeVisible();
  await page.clock.runFor(1000);
  await expect(said(page)).toHaveText(/上次的確認連結已經過期/);
});

// WCAG 1.4.1: how serious a finding is shows in words, not only in the colour of its edge.
test("each kind of finding says how serious it is", async ({ page }) => {
  await backend(page, { ...ended, report: seal(FULL_REPORT) });
  await withKey(page);
  await goto(page);
  const summary = page.getByTestId("inspect-kind");
  await expect(summary.nth(0)).toContainText("已知威脅");
  await expect(summary.nth(1)).toContainText("需要檢查");
  // each list of sites sits in the block of its kind, under the words that say how serious it is
  await expect(summary.nth(0).getByTestId("inspect-group")).toHaveCount(1);
  await expect(summary.nth(1).getByTestId("inspect-group")).toHaveCount(1);
});

// What the report comes to, at the top, and when each site was seen. The reports below are in the format analyze.py
// writes since 2026-11-10 (each site with its hours, no names that could not be found); the days and hours are drawn on
// the reader's clock, so these run on Taipei's.

test.describe("the report says what it comes to, and when each site was seen", () => {
  test.use({ timezoneId: "Asia/Taipei" });

  const plus = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString();
  const endedWith = (report: object) =>
    ({ ...BASE, status: "ended", started_at: WEEK_START, ends_at: plus(WEEK_START, 7), report_until: "2026-11-15", report: seal(report) });
  const open = async (page: Page, inspection: object, now = "2026-11-08T03:00:00Z") => {
    await page.clock.setFixedTime(new Date(now));
    await backend(page, inspection);
    await withKey(page);
    await goto(page);
    await expect(page.getByTestId("inspect-report")).toBeVisible();
  };
  const verdict = (page: Page) => page.getByTestId("inspect-verdict");

  test("sites seen once, in the small hours of the first day: what to check, and that it looks like browsing", async ({ page }) => {
    // day 1 of 7, at 3 pm: the sites at 2 am, twelve hours of use since
    await open(page, { ...BASE, status: "active", started_at: ONCE_START, ends_at: plus(ONCE_START, 7), report: seal(ONCE_REPORT) }, "2026-11-10T07:10:00Z");
    await expect(verdict(page)).toHaveAttribute("data-state", "check");
    await expect(verdict(page).getByRole("heading", { level: 2 })).toHaveText("需要檢查");
    await expect(page.getByTestId("inspect-reason")).toHaveText("名單上的網站集中出現在 11/10 凌晨，之後沒有再出現，比較像瀏覽網頁時遇到的廣告或轉址。");
    await expect(page.getByRole("heading", { name: "接下來可以做" })).toHaveCount(0);
    // the week so far: today, and the days still to come drawn apart
    const cover = page.getByTestId("inspect-cover");
    await expect(cover).toContainText("檢測第 1 天，共 7 天（11/10 到 11/17），目前累積 13 小時有連線。");
    await expect(cover.locator(".cover__day--today")).toHaveCount(1);
    await expect(cover.locator(".cover__day--future")).toHaveCount(7);
    // a row a site, the first few drawn, each saying it was seen once
    const words = page.getByTestId("inspect-hit-words");
    await expect(words.first()).toHaveText("只出現在 1 個時段 · 最後一次在 11/10 02:03");
    await expect(page.getByTestId("inspect-hits").first().locator(":scope > ul > li")).toHaveCount(3);
    await expect(page.getByTestId("inspect-hits-more").first()).toContainText("其餘 1 個網站");
    // the kinds are named for the lists, with what can put a site on them
    await expect(page.getByTestId("inspect-kind").first()).toContainText("惡意網站名單");
    await expect(page.getByTestId("inspect-why").first()).toContainText("瀏覽網頁時的廣告或轉址也可能連到");
    // the hours: the night's five columns on each day's row, and the hour that sent more than it received
    const tiles = page.getByTestId("inspect-tiles");
    // the days still to come have a bar at the top, and no row of hours yet
    await expect(tiles.locator(".tiles__row:not(.tiles__axis)")).toHaveCount(1);
    await expect(tiles.locator(".tile--night")).toHaveCount(5);
    await expect(tiles.locator(".tile--up")).toHaveText("↑");
    await expect(page.getByTestId("inspect-tiles-legend")).toContainText("上傳偏多（至少 20 MB，且多於下載）");
    // less than a day: no share of the night yet
    await expect(page.getByTestId("inspect-idle")).toHaveText("累積滿一天後顯示");
    // what was checked, in words, the numbers folded
    const checks = page.getByTestId("inspect-check");
    await expect(checks.nth(0)).toHaveText("沒有發現跟蹤軟體");
    await expect(checks.nth(0)).toHaveAttribute("data-state", "ok");
    await expect(checks.nth(1)).toHaveText("有連往惡意網站名單上的網站");
    await expect(checks.nth(1)).toHaveAttribute("data-state", "check");
    await expect(page.getByTestId("inspect-figures")).toHaveJSProperty("open", false);
  });

  test("sites seen at the very end of what there is so far are not said to have stopped", async ({ page }) => {
    const report = { ...ONCE_REPORT, hours: ONCE_REPORT.hours.slice(0, 4), coverage: { active_hours: 4, total_hours: 4 } };
    await open(page, { ...BASE, status: "active", started_at: ONCE_START, ends_at: plus(ONCE_START, 7), report: seal(report) }, "2026-11-09T22:30:00Z");
    await expect(page.getByTestId("inspect-reason")).toHaveText("名單上的網站集中出現在 11/10 凌晨，比較像瀏覽網頁時遇到的廣告或轉址。之後幾天也出現的話，就可能是某個 App 在固定連線。");
  });

  test("a site seen day after day: on how many days, and a suggestion to look at the apps", async ({ page }) => {
    await open(page, endedWith(WEEK_REPORT));
    await expect(verdict(page)).toHaveAttribute("data-state", "check");
    await expect(page.getByTestId("inspect-reason")).toContainText("名單上的網站在 6 天出現，共 11 個時段");
    await expect(page.getByTestId("inspect-reason")).toContainText("建議檢查最近裝了哪些不認識的 App");
    // seen day after day: the same steps as for a known threat, in the card at the top
    await expect(verdict(page).getByRole("heading", { name: "接下來可以做" })).toBeVisible();
    await expect(verdict(page).locator("ol > li")).toHaveCount(3);
    await expect(page.getByTestId("inspect-cover")).toContainText("檢測期間（11/01 到 11/08）共 96 小時有連線。");
    // the device was off on 11/04 and the last morning: six days it could have been seen on, and it was on all six
    const beacon = page.getByTestId("inspect-hit").filter({ hasText: "beacon.example" });
    await expect(beacon.getByTestId("inspect-hit-words")).toContainText("有連線的 6 天中 6 天出現，共 9 個時段");
    await expect(beacon.locator(".hit")).toHaveCount(8);
    await expect(beacon.locator(".hit--off")).toHaveCount(2);
    const rare = page.getByTestId("inspect-hit").filter({ hasText: "rare.example" });
    await expect(rare.getByTestId("inspect-hit-words")).toContainText("只出現在 1 個時段");
    // the same in a table
    const table = page.getByTestId("inspect-hits-table");
    const beaconRow = table.locator("tr").filter({ hasText: "beacon.example" });
    // a day to a line, and the last time with its day, so a report read later or saved to a file still says which day
    await expect(beaconRow.locator(".inspect-table__when").first().locator("span"))
      .toHaveText(["11/01 (1)", "11/02 (2)", "11/03 (1)", "11/05 (2)", "11/06 (1)", "11/07 (2)"]);
    await expect(beaconRow.locator(".inspect-table__when").last()).toHaveText("11/07 17:13");
    // on a phone the site's name is what wraps: no day or time is broken over two lines, and the headings stay readable
    await table.evaluate((el) => el.closest("details")!.setAttribute("open", ""));
    for (const cell of await table.locator(".inspect-table__when span").all()) {
      const box = await cell.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { h: r.height, line: parseFloat(getComputedStyle(el).lineHeight) };
      });
      expect(box.h).toBeLessThan(box.line * 1.5);
    }
    expect(await table.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(page.getByTestId("inspect-idle")).toHaveText("2%");
    // the hours on the same days as the bars at the top: 11/04 and 11/08, without a connection, keep a row of their own
    const rows = page.getByTestId("inspect-tiles").locator(".tiles__row:not(.tiles__axis)");
    await expect(rows).toHaveCount(await page.getByTestId("inspect-cover").locator(".cover__day").count());
    await expect(rows).toHaveCount(8);
    await expect(rows.nth(3)).toHaveClass(/tiles__row--off/);
    await expect(rows.nth(3)).toContainText("11/04沒有連線");
    await expect(page.getByTestId("inspect-hours-table").locator("tr").filter({ hasText: "沒有連線" })).toHaveText(["11/04沒有連線", "11/08沒有連線"]);
  });

  test("stalkerware: a known threat, with when it was seen and what to do", async ({ page }) => {
    await open(page, endedWith(THREAT_REPORT));
    await expect(verdict(page)).toHaveAttribute("data-state", "threat");
    await expect(verdict(page).getByRole("heading", { level: 2 })).toHaveText("已知威脅");
    await expect(page.getByTestId("inspect-reason")).toHaveText("跟蹤軟體名單上的網站出現在 3 天、4 個時段，最後一次在 11/06 11:13。一般瀏覽網頁很少連到這類網站，請照下面的步驟檢查。");
    // what to do sits in the card at the top, ahead of the sites and the hours
    const next = verdict(page).getByRole("heading", { name: "接下來可以做" });
    await expect(next).toBeVisible();
    const [at, kinds] = await Promise.all([next.boundingBox(), page.getByTestId("inspect-summary").boundingBox()]);
    expect(at!.y).toBeLessThan(kinds!.y);
    await expect(page.getByTestId("inspect-check").first()).toHaveAttribute("data-state", "threat");
    await expect(page.getByTestId("inspect-check").last()).toHaveText("有些查詢沒有經過 Vessel");
  });

  test("nothing found: said first, and every check passed", async ({ page }) => {
    await open(page, endedWith(CLEAN_REPORT));
    await expect(verdict(page)).toHaveAttribute("data-state", "clean");
    await expect(verdict(page).getByRole("heading", { level: 2 })).toHaveText("沒有發現");
    await expect(page.getByTestId("inspect-reason")).toHaveText("檢測期間沒有發現連往名單上的可疑網站。");
    await expect(page.getByTestId("inspect-summary")).toHaveCount(0);
    for (const c of await page.getByTestId("inspect-check").all()) await expect(c).toHaveAttribute("data-state", "ok");
  });

  test("a report from before the hours were added says what and how much, and draws no times", async ({ page }) => {
    await open(page, endedWith(FULL_REPORT));
    await expect(verdict(page)).toHaveAttribute("data-state", "threat");
    await expect(page.getByTestId("inspect-reason")).toHaveText("裝置連往跟蹤軟體名單上的網站，共 2 個網站、7 次，請照下面的步驟檢查。");
    await expect(page.getByTestId("inspect-hits")).toHaveCount(0);
    await expect(page.getByTestId("inspect-group")).toHaveCount(2);
    await expect(page.getByTestId("inspect-report")).not.toContainText("gone.example");
    await expect(page.getByTestId("inspect-idle")).toHaveText("40%");
  });

  test("the rows past the first few fold away", async ({ page }) => {
    await open(page, endedWith(MANY_REPORT));
    const hits = page.getByTestId("inspect-hits");
    await expect(hits.locator(":scope > ul > li")).toHaveCount(3);
    const more = page.getByTestId("inspect-hits-more");
    await expect(more).toHaveJSProperty("open", false);
    await expect(more.locator("summary")).toHaveText("其餘 5 個網站");
    await expect(more.getByTestId("inspect-hit")).toHaveCount(5);
  });

  test("the downloaded report keeps the verdict and the drawings, ended or in progress", async ({ page }) => {
    await open(page, endedWith(WEEK_REPORT));
    let { html } = await downloaded(page);
    expect(html).toContain('data-state="check"');
    expect(html).toContain("名單上的網站在 6 天出現");
    expect(html).toContain("有連線的 6 天中 6 天出現");
    expect(html).toMatch(/class="hit hit--1"/);
    expect(html).toMatch(/class="cover__fill" style="height: [\d.]+%;?"/);
    expect(html).toContain("tile--night");
    expect(html).toContain(".hit--3");
    expect(html.match(/報告只涵蓋檢測期間的連線/g)).toHaveLength(1);
    // the folded rows are open in the file
    expect(html.match(/<details[^>]*>/g)!.every((tag) => /\bopen\b/.test(tag))).toBe(true);

    await page.unrouteAll();
    await open(page, { ...BASE, status: "active", started_at: ONCE_START, ends_at: plus(ONCE_START, 7), report: seal(ONCE_REPORT) }, "2026-11-10T07:10:00Z");
    ({ html } = await downloaded(page));
    expect(html).toContain("檢測第 1 天，共 7 天");
    expect(html).toContain("cover__day--today");
    expect(html).toContain("只出現在 1 個時段");
    expect(html).toContain("tile--up");
  });

  test("the device is a label: its name, the node it goes out through and its filter, in the file too without the flag", async ({ page }) => {
    await open(page, endedWith(WEEK_REPORT));
    const label = page.getByTestId("inspect-device");
    await expect(label.locator(".inspect-device__name")).toHaveText("檢測的裝置：我的手機");
    await expect(label.locator(".inspect-device__facts")).toContainText("新加坡");
    await expect(label.locator(".inspect-device__facts")).toContainText("不過濾");
    await expect(label.locator("img.flag")).toHaveCount(1);
    // the frame's DEVICE is drawn, not read out
    expect(await label.evaluate((el) => getComputedStyle(el, "::before").content)).toMatch(/^"DEVICE"/);
    const { html } = await downloaded(page);
    expect(html).toContain('data-testid="inspect-device"');
    expect(html).toContain("新加坡");
    expect(html.match(/<img[^>]*class="flag/g)).toBeNull();
  });

  test("one ended early ends where copying stopped, and the days after it are not drawn", async ({ page }) => {
    // planned for 11/01 to 11/08, stopped on 11/05 in the evening
    const report = { ...WEEK_REPORT, hours: WEEK_REPORT.hours.filter((h) => h.hour < "2026-11-05T12"), findings: [], checks: WEEK_REPORT.checks.map((c) => ({ ...c, count: 0 })) };
    await open(page, { ...endedWith(report), stopped_at: "2026-11-05T12:30:00Z" });
    const cover = page.getByTestId("inspect-cover");
    await expect(cover).toContainText("檢測期間（11/01 到 11/05）");
    await expect(cover.locator(".cover__day")).toHaveCount(5);
    await expect(page.getByTestId("inspect-tiles").locator(".tiles__row:not(.tiles__axis)")).toHaveCount(5);
    // without it (a portal from before), the planned end, as before
    await page.unrouteAll();
    await open(page, endedWith(report));
    await expect(page.getByTestId("inspect-cover").locator(".cover__day")).toHaveCount(8);
  });

  // What the lists say about each site (toomore/anoni-net-ws#480): written under the site, and in the reason only as one
  // more sentence. It never lowers the state: a site an ad list also has still needs a check, stalkerware stays a threat.
  const ONCE_REASON = "名單上的網站集中出現在 11/10 凌晨，之後沒有再出現，比較像瀏覽網頁時遇到的廣告或轉址。";
  const ADS_NOTE = "命中的網站也都列在廣告與追蹤名單上。";
  const running = (report: object) => ({ ...BASE, status: "active", started_at: ONCE_START, ends_at: plus(ONCE_START, 7), report: seal(report) });
  const lists = (page: Page, name: string) => page.getByTestId("inspect-hit").filter({ hasText: name }).getByTestId("inspect-hit-lists");

  test("each site says which other lists it is on, and a site on its own list says nothing more", async ({ page }) => {
    await open(page, running(ONCE_LISTS_REPORT), "2026-11-10T07:10:00Z");
    await expect(lists(page, "ads-redirect.example")).toHaveText("也列在廣告與追蹤名單上");
    await expect(lists(page, "popunder.example")).toHaveText("同時列在 3 份名單上：惡意網站名單、資安威脅情報名單、廣告與追蹤名單");
    await expect(lists(page, "promo.example")).toHaveCount(0);
    // the words on when it was seen are as they were, the lists on a line of their own
    await expect(page.getByTestId("inspect-hit").filter({ hasText: "ads-redirect.example" }).getByTestId("inspect-hit-words")).toHaveText("只出現在 1 個時段 · 最後一次在 11/10 02:03");
    // one of them only on its own list: the reason says nothing about the ad list
    await expect(verdict(page)).toHaveAttribute("data-state", "check");
    await expect(page.getByTestId("inspect-reason")).toHaveText(ONCE_REASON);
  });

  test("every site of a one-off also on the ad list: one more sentence, and it still needs a check", async ({ page }) => {
    await open(page, running(ONCE_ADS_REPORT), "2026-11-10T07:10:00Z");
    await expect(page.getByTestId("inspect-reason")).toHaveText(ONCE_REASON + ADS_NOTE);
    // the state as it was without the lists: needs a check, in the card, on each kind and in the checks
    await expect(verdict(page)).toHaveAttribute("data-state", "check");
    await expect(verdict(page).getByRole("heading", { level: 2 })).toHaveText("需要檢查");
    await expect(verdict(page).locator(".inspect-verdict__state .icon")).toHaveCount(1);
    for (const kind of await page.getByTestId("inspect-kind").all()) await expect(kind.getByTestId("inspect-severity")).toContainText("需要檢查");
    const checks = page.getByTestId("inspect-check");
    await expect(checks.nth(1)).toHaveAttribute("data-state", "check");
    await expect(checks.nth(2)).toHaveAttribute("data-state", "check");
    await expect(page.getByTestId("inspect-tiles").locator(".tile--check")).toHaveCount(1);
    await expect(page.getByTestId("inspect-hit-lists")).toHaveCount(8);
  });

  test("a single site on the ad list too says so in the singular", async ({ page }) => {
    const report = { ...ONCE_ADS_REPORT, findings: ONCE_ADS_REPORT.findings.slice(0, 1), checks: ONCE_REPORT.checks.map((c) => ({ ...c, count: c.id === "malware" ? 2 : 0 })) };
    await open(page, running(report), "2026-11-10T07:10:00Z");
    await expect(page.getByTestId("inspect-reason")).toHaveText(ONCE_REASON + "命中的網站也列在廣告與追蹤名單上。");
    await expect(verdict(page)).toHaveAttribute("data-state", "check");
  });

  test("on the ad list but seen day after day, or left out of the report: no sentence, and the steps stay", async ({ page }) => {
    await open(page, endedWith(WEEK_ADS_REPORT));
    await expect(verdict(page)).toHaveAttribute("data-state", "check");
    await expect(page.getByTestId("inspect-reason")).toContainText("名單上的網站在 6 天出現，共 11 個時段");
    await expect(page.getByTestId("inspect-reason")).not.toContainText("廣告與追蹤名單");
    await expect(verdict(page).getByRole("heading", { name: "接下來可以做" })).toBeVisible();
    await expect(lists(page, "beacon.example")).toHaveText("也列在廣告與追蹤名單上");
    // sites the report does not list may not be on the ad list
    await page.unrouteAll();
    await open(page, running({ ...ONCE_ADS_REPORT, more: { cti: 2 } }), "2026-11-10T07:10:00Z");
    await expect(page.getByTestId("inspect-reason")).toHaveText(ONCE_REASON);
  });

  test("stalkerware an ad list also has is still a known threat, with the same reason and steps", async ({ page }) => {
    await open(page, endedWith(THREAT_ADS_REPORT));
    await expect(verdict(page)).toHaveAttribute("data-state", "threat");
    await expect(verdict(page).getByRole("heading", { level: 2 })).toHaveText("已知威脅");
    await expect(page.getByTestId("inspect-reason")).toHaveText("跟蹤軟體名單上的網站出現在 3 天、4 個時段，最後一次在 11/06 11:13。一般瀏覽網頁很少連到這類網站，請照下面的步驟檢查。");
    await expect(verdict(page).getByRole("heading", { name: "接下來可以做" })).toBeVisible();
    await expect(page.getByTestId("inspect-check").first()).toHaveAttribute("data-state", "threat");
    await expect(lists(page, "collect.example")).toHaveText("也列在廣告與追蹤名單上");
  });

  test("a report from before the lists were compared says nothing about them", async ({ page }) => {
    await open(page, running(ONCE_REPORT), "2026-11-10T07:10:00Z");
    await expect(page.getByTestId("inspect-hit")).toHaveCount(8);
    await expect(page.getByTestId("inspect-hit-lists")).toHaveCount(0);
    await expect(page.getByTestId("inspect-reason")).toHaveText(ONCE_REASON);
    await page.unrouteAll();
    await open(page, endedWith(FULL_REPORT));
    await expect(page.getByTestId("inspect-hit-lists")).toHaveCount(0);
  });

  test("sites seen in more hours of the one day, all on the ad list too: the sentence is added there as well", async ({ page }) => {
    await open(page, running(ONE_DAY_ADS_REPORT), "2026-11-10T07:10:00Z");
    await expect(page.getByTestId("inspect-reason")).toHaveText("名單上的網站只在 11/10 出現，共 4 個時段。之後幾天也出現的話，建議檢查最近安裝的 App。" + ADS_NOTE);
    await expect(verdict(page)).toHaveAttribute("data-state", "check");
    await expect(verdict(page).getByRole("heading", { level: 2 })).toHaveText("需要檢查");
  });

  // The stalkerware a site belongs to, from Echap's stalkerware-indicators (CC BY 4.0): a name from outside, put on the
  // page as text, with where it comes from.
  const app = (page: Page, name: string) => page.getByTestId("inspect-hit").filter({ hasText: name }).getByTestId("inspect-hit-app");

  test("a stalkerware site says which app it belongs to, the reason names it, and the source is credited", async ({ page }) => {
    await open(page, endedWith(THREAT_APP_REPORT));
    await expect(app(page, "collect.example")).toHaveText("屬於跟蹤軟體 FakeSpy");
    await expect(page.getByTestId("inspect-reason")).toHaveText("跟蹤軟體 FakeSpy 使用的網站出現在 3 天、4 個時段，最後一次在 11/06 11:13。一般瀏覽網頁很少連到這類網站，請照下面的步驟檢查。");
    await expect(verdict(page)).toHaveAttribute("data-state", "threat");
    const source = page.getByTestId("inspect-app-source");
    await expect(source).toHaveText("跟蹤軟體的名稱取自 Echap 的 stalkerware-indicators，資料授權是 CC BY 4.0。");
    // under the stalkerware, the one kind it is about
    await expect(page.getByTestId("inspect-kind").filter({ hasText: "跟蹤軟體" }).getByTestId("inspect-app-source")).toHaveCount(1);
    const repo = source.getByRole("link", { name: "Echap 的 stalkerware-indicators" });
    await expect(repo).toHaveAttribute("href", "https://github.com/AssoEchap/stalkerware-indicators");
    await expect(repo).toHaveAttribute("target", "_blank");
    await expect(repo).toHaveAttribute("rel", "noopener");
    await expect(source.getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
  });

  test("an app's name is shown as it is, markup and all, and two apps are counted", async ({ page }) => {
    await open(page, endedWith(THREAT_APPS_REPORT));
    await expect(app(page, "upload.example")).toHaveText("屬於跟蹤軟體 <b>Spy</b> & Co");
    await expect(page.getByTestId("inspect-report").locator("b")).toHaveCount(0);
    await expect(page.getByTestId("inspect-reason")).toHaveText(/^2 個跟蹤軟體使用的網站出現在 4 天、5 個時段/);
    // one of the two without a name: the reason does not guess
    await page.unrouteAll();
    const report = { ...THREAT_APPS_REPORT, findings: THREAT_APPS_REPORT.findings.map((f, i) => (i === 1 ? { ...f, app: undefined } : f)) };
    await open(page, endedWith(report));
    await expect(page.getByTestId("inspect-reason")).toHaveText(/^跟蹤軟體名單上的網站出現在/);
    await expect(page.getByTestId("inspect-hit-app")).toHaveCount(1);
    await expect(page.getByTestId("inspect-app-source")).toHaveCount(1);
  });

  test("without an app's name, nothing about apps is said", async ({ page }) => {
    await open(page, endedWith(THREAT_REPORT));
    await expect(page.getByTestId("inspect-hit-app")).toHaveCount(0);
    await expect(page.getByTestId("inspect-app-source")).toHaveCount(0);
    await expect(page.getByTestId("inspect-reason")).toHaveText(/^跟蹤軟體名單上的網站出現在/);
  });

  test("the downloaded report has the app's name and where it comes from", async ({ page }) => {
    await open(page, endedWith(THREAT_APPS_REPORT));
    const { html } = await downloaded(page);
    expect(html).toContain("屬於跟蹤軟體 FakeSpy");
    expect(html).toContain("屬於跟蹤軟體 &lt;b&gt;Spy&lt;/b&gt; &amp; Co");
    expect(html).not.toContain("<b>Spy</b>");
    expect(html).toContain('href="https://github.com/AssoEchap/stalkerware-indicators"');
    expect(html).toContain('href="https://creativecommons.org/licenses/by/4.0/"');
  });

  test("in English, the lists are named and the sentence added", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-10T07:10:00Z"));
    await backend(page, running(ONCE_LISTS_REPORT));
    await withKey(page);
    await page.goto(`/en/devices/inspect/?d=${ID}`);
    await expect(lists(page, "ads-redirect.example")).toHaveText("Also on the ad and tracking list");
    await expect(lists(page, "popunder.example")).toHaveText("On 3 lists: malicious site list, threat intelligence list, ad and tracking list");
    await page.unrouteAll();
    await backend(page, running(ONCE_ADS_REPORT));
    await page.goto(`/en/devices/inspect/?d=${ID}`);
    await expect(page.getByTestId("inspect-reason")).toContainText("browsing. Every one of these sites is also on the ad and tracking list.");
    await expect(verdict(page)).toHaveAttribute("data-state", "check");
    await page.unrouteAll();
    await backend(page, { ...BASE, status: "ended", started_at: WEEK_START, ends_at: plus(WEEK_START, 7), report_until: "2026-11-15", report: seal(THREAT_APP_REPORT) });
    await page.goto(`/en/devices/inspect/?d=${ID}`);
    await expect(page.getByTestId("inspect-hit-app")).toHaveText("Belongs to the stalkerware FakeSpy");
    await expect(page.getByTestId("inspect-reason")).toContainText("Sites used by the stalkerware FakeSpy were seen on 3 days");
    await expect(page.getByTestId("inspect-app-source")).toHaveText("Stalkerware names come from stalkerware-indicators by Echap, under CC BY 4.0.");
  });

  test("the downloaded report has the lists and the sentence", async ({ page }) => {
    await open(page, running(ONCE_ADS_REPORT), "2026-11-10T07:10:00Z");
    let { html } = await downloaded(page);
    expect(html).toContain(ADS_NOTE);
    expect(html).toContain("也列在廣告與追蹤名單上");
    expect(html).toContain('data-state="check"');
    await page.unrouteAll();
    await open(page, endedWith(ONCE_LISTS_REPORT));
    ({ html } = await downloaded(page));
    expect(html).toContain("同時列在 3 份名單上：惡意網站名單、資安威脅情報名單、廣告與追蹤名單");
    // the folded rows are open in the file, with their lists
    expect(html.match(/data-testid="inspect-hit-lists"/g)).toHaveLength(7);
  });
});

// A wide screen: the page takes the width in every state, the report in rows in the order of the page, and a phone
// keeps the one column.
test.describe("on a wide screen", () => {
  test.use({ timezoneId: "Asia/Taipei", viewport: { width: 1280, height: 800 } });
  const box = async (page: Page, testid: string) => (await page.getByTestId(testid).first().boundingBox())!;
  const order = (page: Page, ids: string[]) => page.evaluate((ids) => {
    const nodes = ids.map((id) => document.querySelector(`[data-testid="${id}"]`)!);
    return nodes.every((n, i) => i === 0 || !!(nodes[i - 1]!.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING));
  }, ids);
  const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  test("the report reads in rows: what it comes to with the days beside it, the sites, then the hours beside the checks", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-08T03:00:00Z"));
    await backend(page, { ...BASE, status: "ended", started_at: WEEK_START, ends_at: "2026-11-08T02:00:00Z", report_until: "2026-11-15", report: seal(THREAT_REPORT) });
    await withKey(page);
    await goto(page);
    await expect(page.getByTestId("inspect-report")).toBeVisible();
    const [verdict, cover, findings, hours, checks] = await Promise.all(
      ["inspect-verdict", "inspect-cover", "inspect-summary", "inspect-tiles", "inspect-checks"].map((id) => box(page, id)));
    const report = await box(page, "inspect-report");
    // wider than the narrow column, and the days beside what it comes to
    expect(report.width).toBeGreaterThan(900);
    expect(cover.x).toBeGreaterThan(verdict.x + verdict.width / 3);
    expect(cover.y).toBeLessThan(verdict.y + 80);
    expect(findings.y).toBeGreaterThan(verdict.y + verdict.height);
    // the hours and the checks side by side, below the sites
    expect(hours.y).toBeGreaterThan(findings.y + findings.height);
    expect(checks.x).toBeGreaterThan(hours.x + hours.width);
    expect(Math.abs(checks.y - hours.y)).toBeLessThan(120);
    // a site's name, its week and the words on one line
    const row = page.getByTestId("inspect-hit").first();
    const [name, cells, words] = await Promise.all([row.locator("code").boundingBox(), row.locator(".hits__grid").boundingBox(), row.getByTestId("inspect-hit-words").boundingBox()]);
    expect(Math.abs(name!.y - cells!.y)).toBeLessThan(20);
    expect(words!.x).toBeGreaterThan(cells!.x + cells!.width);
    // what to do sits in the first card; the page, the keyboard and a screen reader meet them in the order they are seen
    expect(await order(page, ["inspect-verdict", "inspect-summary", "inspect-tiles", "inspect-checks"])).toBe(true);
    const next = await page.getByRole("heading", { name: "接下來可以做" }).boundingBox();
    expect(next!.y).toBeLessThan(findings.y);
    expect(await sideways(page)).toBe(0);
  });

  const ended = { ...BASE, status: "ended", started_at: WEEK_START, ends_at: "2026-11-08T02:00:00Z", report_until: "2026-11-15", report: seal(WEEK_REPORT) };
  /** The labels under the bars at the top and over the squares of the sites: what each shows, and that none runs into the next. */
  const labels = (page: Page, selector: string) => page.locator(selector).evaluateAll((all) => all.map((e) => {
    const shown = [...e.children].find((c) => getComputedStyle(c).display !== "none")!;
    const r = shown.getBoundingClientRect();
    return { text: shown.textContent, left: r.left, right: r.right, cell: e.getBoundingClientRect().width };
  }));
  const apart = (tags: { left: number; right: number; cell: number }[]) =>
    tags.every((tag, i) => tag.right - tag.left <= tag.cell + 0.5 && (i === 0 || tags[i - 1]!.right <= tag.left));

  for (const width of [1280, 960]) {
    test(`at ${width}px the days are labelled with their full dates, eight across without running into each other`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.clock.setFixedTime(new Date("2026-11-08T03:00:00Z"));
      await backend(page, ended);
      await withKey(page);
      await goto(page);
      await expect(page.getByTestId("inspect-report")).toBeVisible();
      for (const selector of ['[data-testid="inspect-cover"] .cover__label', '[data-testid="inspect-hits"] >> nth=0 >> .hits__day']) {
        const tags = await labels(page, selector);
        expect(tags.map((x) => x.text), selector).toEqual(["11/01", "11/02", "11/03", "11/04", "11/05", "11/06", "11/07", "11/08"]);
        expect(apart(tags), selector).toBe(true);
      }
    });
  }

  test("deleting the report is a link at the start of the line, under the way back to the devices", async ({ page }) => {
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 800 });
      await page.unrouteAll();
      await backend(page, ended);
      await withKey(page);
      await goto(page);
      const [del, back] = await Promise.all([page.getByRole("button", { name: "現在刪除報告" }).boundingBox(), page.getByRole("link", { name: "回到裝置清單" }).boundingBox()]);
      expect(Math.abs(del!.x - back!.x), `${width}`).toBeLessThan(1);
      expect(del!.width, `${width}`).toBeLessThan(200);
    }
  });

  test("the downloaded report has the wide layout too", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-08T03:00:00Z"));
    await backend(page, { ...BASE, status: "ended", started_at: WEEK_START, ends_at: "2026-11-08T02:00:00Z", report_until: "2026-11-15", report: seal(WEEK_REPORT) });
    await withKey(page);
    await goto(page);
    const { html } = await downloaded(page);
    await page.unrouteAll();
    await page.goto("about:blank");
    await page.setContent(html);
    const [hours, checks] = await Promise.all([box(page, "inspect-tiles"), box(page, "inspect-checks")]);
    expect(checks.x).toBeGreaterThan(hours.x + hours.width);
    expect((await box(page, "inspect-report")).width).toBeGreaterThan(900);
    expect(await sideways(page)).toBe(0);
  });

  const running = { ...BASE, status: "active", report: SEALED, ends_at: new Date(Date.now() + 4.5 * 86_400_000).toISOString() };

  test("a running inspection's status is a label like the device's, beside it, and below it on a phone", async ({ page }) => {
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 800 });
      await page.unrouteAll();
      await backend(page, running);
      await withKey(page);
      await goto(page);
      const status = page.getByTestId("inspect-status");
      await expect(status).toContainText("檢測中，第 3 天，共 7 天");
      const [device, card] = await Promise.all([box(page, "inspect-device"), box(page, "inspect-status")]);
      const facts = await Promise.all(["inspect-device", "inspect-status"].map(async (id) => (await page.getByTestId(id).locator(".inspect-device__facts").boundingBox())!));
      expect(await status.evaluate((e) => getComputedStyle(e, "::before").content), `${width}`).toContain("STATUS");
      if (width > 960) {
        expect(Math.abs(card.y - device.y)).toBeLessThan(1);
        expect(card.x).toBeGreaterThan(device.x + device.width);
        expect(Math.abs(card.height - device.height)).toBeLessThan(1);
        // the lines under the hairline at the same height, the link to end it early not making its row taller
        expect(Math.abs(facts[0]!.y - facts[1]!.y)).toBeLessThan(1);
        expect(facts[1]!.height).toBeLessThan(facts[0]!.height + 4);
      } else {
        expect(card.y).toBeGreaterThan(device.y + device.height + 8);
        expect(Math.abs(card.x - device.x)).toBeLessThan(1);
      }
      expect(await sideways(page), `${width}`).toBe(0);
    }
  });

  test("under the results so far, the key on the left and what they cannot tell on the right; one above the other on a phone", async ({ page }) => {
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 800 });
      await page.unrouteAll();
      await backend(page, running);
      await withKey(page);
      await goto(page);
      await expect(page.getByTestId("inspect-report")).toBeVisible();
      const [report, key, notes] = await Promise.all([box(page, "inspect-report"), box(page, "inspect-key"), box(page, "inspect-notes")]);
      expect(key.y, `${width}`).toBeGreaterThan(report.y + report.height);
      if (width > 960) {
        expect(notes.x).toBeGreaterThan(key.x + key.width);
        expect(Math.abs(notes.y - key.y)).toBeLessThan(2);
      } else {
        expect(notes.y).toBeGreaterThan(key.y + key.height);
      }
      // the key first, as it is seen
      expect(await order(page, ["inspect-key", "inspect-notes"]), `${width}`).toBe(true);
      expect(await sideways(page), `${width}`).toBe(0);
    }
  });

  test("the consent page puts its two cards side by side, and keeps its text and button at the narrow width", async ({ page }) => {
    await backend(page, { ...BASE, status: "none" });
    await goto(page);
    const cards = page.getByTestId("inspect-consent").locator(".inspect-pair > .card");
    const [a, b] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    expect(b!.x).toBeGreaterThan(a!.x + a!.width);
    expect((await page.getByRole("button", { name: "同意並開始" }).boundingBox())!.width).toBeLessThanOrEqual(520);
    // the heading stays where it is in every state
    expect((await page.locator("main h1").boundingBox())!.x).toBeLessThan(a!.x + 1);
    expect(await sideways(page)).toBe(0);
  });

  test("on a phone the consent page's cards stay one above the other, apart", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await backend(page, { ...BASE, status: "none" });
    await goto(page);
    const cards = page.getByTestId("inspect-consent").locator(".inspect-pair > .card");
    const [a, b] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
    expect(b!.y - (a!.y + a!.height)).toBeGreaterThanOrEqual(16);
    expect(Math.abs(a!.x - b!.x)).toBeLessThan(1);
  });

  test("a phone keeps the one column", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.clock.setFixedTime(new Date("2026-11-08T03:00:00Z"));
    await backend(page, { ...BASE, status: "ended", started_at: WEEK_START, ends_at: "2026-11-08T02:00:00Z", report_until: "2026-11-15", report: seal(WEEK_REPORT) });
    await withKey(page);
    await goto(page);
    await expect(page.getByTestId("inspect-report")).toBeVisible();
    const [verdict, cover, hours, checks] = await Promise.all(["inspect-verdict", "inspect-cover", "inspect-tiles", "inspect-checks"].map((id) => box(page, id)));
    expect(cover.y).toBeGreaterThan(verdict.y + 100);
    expect(checks.y).toBeGreaterThan(hours.y + hours.height);
    expect(Math.abs(checks.x - hours.x)).toBeLessThan(40);
    // the days under the bars and over the squares: their numbers alone, side by side
    for (const selector of ['[data-testid="inspect-cover"] .cover__label', '[data-testid="inspect-hits"] >> nth=0 >> .hits__day']) {
      const tags = await labels(page, selector);
      expect(tags.map((x) => x.text), selector).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
      expect(apart(tags), selector).toBe(true);
    }
    expect(await sideways(page)).toBe(0);
  });
});
