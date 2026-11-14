import { type Page, expect, test } from "@playwright/test";

// A member answers a leader's request for an inspection (toomore/anoni-net-ws#483): yes, no, or an inspection of their
// own instead. The backend is mocked.

const ID = "d-1";
const ME = { created_on: "2026-10-27", last_login_on: "2026-11-05", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 0,
  usage_as_of: null, group: { role: "member", label: "A1", device_revoked_on: null } };
const DEVICE = { id: ID, name: "我的手機", region: "sg", dns_filter: "malware", status: "active", created_on: "2026-10-27", expires_on: "2030-01-01",
  used_bytes: 0, blocked: 0, connected: true, moved_until: null, ipv6: true, relay: null, inspection: null,
  inspection_request: { requested_on: "2026-11-10", until: "2026-11-17" }, inspection_group: false };
const BASE = { consent_version: "2026-11-10c", group_consent_version: "2026-11-10g", days: 7, report_days: 7, group: false };
const URL_ = "https://confirm.vessel.anoni.net/c/ABCDEFGHJKLMNPQR";
const groupInspection = (status: string, over: object = {}) => ({
  status, requested_on: "2026-11-10", until: "2026-11-17", started_at: null, ends_at: null, stopped_at: null, ended_early: false,
  report_until: null, ...over,
});

type Sent = { method: string; path: string; body: unknown };

async function backend(page: Page, inspection: object, opts: { after?: object; device?: object; view?: object } = {}) {
  const sent: Sent[] = [];
  let current = inspection;
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== "GET") sent.push({ method: req.method(), path, body: req.postData() ? req.postDataJSON() : null });
    if (path.endsWith("/inspection/decline")) {
      current = { ...BASE, status: "none", requested: false };
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/inspection")) {
      if (req.method() === "POST") {
        if (opts.after) current = opts.after;
        return route.fulfill({ json: { code: "ABCDEFGHJKLMNPQR", url: URL_, minutes: 30 } });
      }
      return route.fulfill({ json: current });
    }
    if (path === "/api/me") return route.fulfill({ json: ME });
    if (path === "/api/devices") return route.fulfill({ json: [{ ...DEVICE, ...opts.device }] });
    if (path === "/api/group/mine") {
      return route.fulfill({ json: opts.view ?? { label: "A1", role: "member", joined_on: "2026-11-01", devices: [] } });
    }
    if (path === "/api/invites") return route.fulfill({ json: { reason: "off", open: [] } });
    if (path === "/api/usage/months") return route.fulfill({ json: { months: [], strongest: null } });
    if (path === "/api/regions") return route.fulfill({ json: [{ id: "sg", open: true }] });
    return route.fulfill({ json: [] });
  });
  return sent;
}

const goto = (page: Page) => page.goto(`/devices/inspect/?d=${ID}`);

test("the device card says a leader asked, and links to the request", async ({ page }) => {
  await backend(page, { ...BASE, status: "none", requested: true });
  await page.goto("/devices/");
  const note = page.getByTestId("inspect-request");
  await expect(note).toContainText("團體的負責人請你檢測這台裝置");
  await expect(note).toContainText("2026/11/17");
  await note.getByRole("link", { name: "查看請求「我的手機」的檢測" }).click();
  await expect(page.getByTestId("inspect-group-consent")).toBeVisible();
});

test("agreeing says what the leaders see, and starts the group's inspection", async ({ page }) => {
  const sent = await backend(page, { ...BASE, status: "none", requested: true },
    { after: { ...BASE, status: "confirming", group: true, confirm_seconds: 1800 } });
  await goto(page);
  const form = page.getByTestId("inspect-group-consent");
  // what a report shows, before agreeing: the sample, in a tab of its own so the form stays
  await expect(form.getByTestId("inspect-sample")).toHaveAttribute("href", "/sample-report/");
  const sees = page.getByTestId("inspect-group-sees");
  await expect(sees).toContainText("判斷結果");
  await expect(sees).toContainText("命中的類別");
  await expect(sees).toContainText("看不到你連往的網站");
  await expect(form.getByRole("button", { name: "同意並開始" })).toBeDisabled();
  // saying no is as easy as saying yes
  await expect(form.getByRole("button", { name: "不同意" })).toBeEnabled();
  await page.getByTestId("inspect-agree").check();
  await form.getByRole("button", { name: "同意並開始" }).click();
  await expect(page.getByTestId("inspect-url")).toHaveAttribute("href", URL_);
  const body = sent.find((s) => s.method === "POST")!.body as { consent_version: string; group: boolean; public_key: string };
  expect(body.group).toBe(true);
  expect(body.consent_version).toBe("2026-11-10g");
  expect(body.public_key).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  await expect(page.getByTestId("inspect-group-note")).toContainText("負責人會看到判斷結果");
});

test("saying no tells the leaders and leaves an inspection of one's own", async ({ page }) => {
  const sent = await backend(page, { ...BASE, status: "none", requested: true });
  await goto(page);
  await page.getByTestId("inspect-decline").click();
  await expect(page.getByTestId("inspect-declined")).toContainText("已回覆負責人你不同意");
  await expect(page.getByTestId("inspect-consent")).toBeVisible();
  await expect(page.getByTestId("inspect-group-consent")).toHaveCount(0);
  expect(sent.some((s) => s.path === `/api/devices/${ID}/inspection/decline`)).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
});

test("one's own inspection can be had instead, and the request stays", async ({ page }) => {
  const sent = await backend(page, { ...BASE, status: "none", requested: true }, { after: { ...BASE, status: "confirming", confirm_seconds: 1800 } });
  await goto(page);
  await page.getByRole("button", { name: "改成只有自己看得到的檢測" }).click();
  const own = page.getByTestId("inspect-consent");
  await expect(own).toContainText("團體的負責人看不到這份報告");
  await page.getByRole("button", { name: "回到負責人的請求" }).click();
  await expect(page.getByTestId("inspect-group-consent")).toBeVisible();
  await page.getByRole("button", { name: "改成只有自己看得到的檢測" }).click();
  await page.getByTestId("inspect-agree").check();
  await own.getByRole("button", { name: "同意並開始" }).click();
  const body = sent.find((s) => s.method === "POST")!.body as { consent_version: string; group?: boolean };
  expect(body.group).toBeUndefined();
  expect(body.consent_version).toBe("2026-11-10c");
  await expect(page.getByTestId("inspect-group-note")).toHaveCount(0);
});

test("deleting a report a leader asked for says what the leaders will see", async ({ page }) => {
  await backend(page, { ...BASE, status: "ended", group: true, started_at: "2026-11-01T00:00:00Z", ends_at: "2026-11-08T00:00:00Z",
    stopped_at: "2026-11-08T00:00:00Z", report: null, report_until: "2026-11-15" });
  let asked = "";
  page.on("dialog", (d) => { asked = d.message(); void d.dismiss(); });
  await goto(page);
  await expect(page.getByTestId("inspect-group-note")).toBeVisible();
  await page.getByRole("button", { name: "現在刪除報告" }).click();
  await expect.poll(() => asked).toContain("負責人看到的結果也會一起刪除");
});

test("the account page shows the member what the leaders see of a request", async ({ page }) => {
  await backend(page, { ...BASE, status: "none" }, { view: { label: "A1", role: "member", joined_on: "2026-11-01", devices: [
    { id: ID, name: "手機", region: "jp", dns_filter: "malware", status: "active", expires_on: "2030-01-01", issues: [],
      inspection: groupInspection("requested") },
    { id: "d-2", name: "筆電", region: "jp", dns_filter: "malware", status: "active", expires_on: "2030-01-01", issues: [],
      inspection: groupInspection("declined") },
  ] } });
  await page.goto("/account/");
  const line = page.getByTestId(`group-view-inspection-${ID}`);
  await expect(line).toContainText("等待成員回應");
  await expect(line.getByRole("link", { name: "前往「手機」的檢測頁" })).toHaveAttribute("href", /\/devices\/inspect\/\?d=d-1$/);
  await expect(page.getByTestId("group-view-inspection-d-2")).toContainText("成員沒有同意");
  await expect(page.getByTestId("group-view-inspection-d-2").getByRole("link")).toHaveCount(0);
});

test("a personal account sees nothing of requests", async ({ page }) => {
  await backend(page, { ...BASE, status: "none" }, { device: { inspection_request: null } });
  await page.goto("/devices/");
  await expect(page.getByTestId("device-inspect")).toBeVisible();
  await expect(page.getByTestId("inspect-request")).toHaveCount(0);
});
