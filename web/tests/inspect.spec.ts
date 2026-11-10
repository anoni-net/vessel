import { type Page, expect, test } from "@playwright/test";
import { FULL_REPORT, KEY, seal } from "./inspect-fixtures.ts";

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
  await expect(report).toContainText("gone.example");
  await expect(page.getByTestId("inspect-tiles").locator(".tile--threat")).toHaveCount(2);
  await expect(page.getByTestId("inspect-tiles").locator(".tile--check")).toHaveCount(1);
  // a mark also has a sign, for whoever cannot tell the colours apart
  await expect(page.getByTestId("inspect-tiles").locator(".tile--check")).toHaveText("!");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("inspect-download").click()]);
  expect(download.suggestedFilename()).toMatch(/^vessel-inspection-.*\.html$/);
  const file = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of file) chunks.push(c as Buffer);
  const html = Buffer.concat(chunks).toString();
  expect(html).toContain("tracker.example");
  expect(html).toContain("<style>");
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
  await expect(page.getByTestId("inspect-running")).toContainText("自動結束");
  await expect(page.getByTestId("inspect-report")).toBeVisible();
  await expect(page.getByTestId("inspect-download")).toHaveCount(0);
  // readable at any time, and it says how far behind it is, below the report
  await expect(page.getByTestId("inspect-delay")).toContainText("延遲 30 分鐘，最久約 1 小時");
  const [report, delay] = await Promise.all([page.getByTestId("inspect-report").boundingBox(), page.getByTestId("inspect-delay").boundingBox()]);
  expect(delay!.y).toBeGreaterThan(report!.y + report!.height - 1);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "結束檢測" }).click();
  await expect(page.getByText("正在結束檢測")).toBeVisible();
  expect(sent).toEqual([{ method: "DELETE", body: null }]);
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

for (const [status, words] of [[null, "檢測流量"], ["active", "檢測中"], ["ended", "檢測報告"]] as const) {
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
  ["ending", { ...BASE, status: "active", report: SEALED, ends_at: "2026-11-16T00:00:00Z" }, true, "結束檢測", { ...BASE, status: "ending" }, "正在結束檢測、整理報告，通常 5 分鐘內完成。"],
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
  const summary = page.getByTestId("inspect-summary").locator("li");
  await expect(summary.nth(0)).toContainText("已知威脅");
  await expect(summary.nth(1)).toContainText("需要檢查");
  await expect(page.getByTestId("inspect-group").nth(0).locator("summary")).toContainText("已知威脅");
  await expect(page.getByTestId("inspect-group").nth(1).locator("summary")).toContainText("需要檢查");
});
