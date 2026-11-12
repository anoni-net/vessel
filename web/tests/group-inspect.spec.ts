import { x25519 } from "@noble/curves/ed25519.js";
import { type Page, expect, test } from "@playwright/test";
import { KEY, seal } from "./inspect-fixtures.ts";

// A leader asks for inspections of members' devices and reads a summary sealed to their own key
// (toomore/anoni-net-ws#483). The backend is mocked; the summaries are sealed here as inspect/analyze.py seals them.

const PUBLIC = Buffer.from(x25519.getPublicKey(Buffer.from(KEY, "base64"))).toString("base64");
const OTHER = "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA=";
const ME = { created_on: "2026-10-27", last_login_on: "2026-11-05", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 0,
  group: { role: "leader", label: "L1", device_revoked_on: null } };
const summary = (s: object, info = "vessel-inspection-summary", to = KEY) => ({ key: PUBLIC, sealed: seal(s, info, to) });
const THREAT = { verdict: "threat", kinds: [{ kind: "stalkerware", severity: "threat" }, { kind: "malware", severity: "check" }],
  coverage: { active_hours: 40, total_hours: 72 } };
const CLEAN = { verdict: "clean", kinds: [], coverage: { active_hours: 100, total_hours: 168 } };
const base = { requested_on: "2026-11-10", until: null, started_at: null, ends_at: null, stopped_at: null, ended_early: false, report_until: null };
const device = (id: string, name: string, inspection: object | null = null) => ({
  id, name, region: "jp", dns_filter: "malware", status: "active", expires_on: "2030-01-01", issues: [], inspection,
});

function group(devices: object[], over: object = {}) {
  return {
    code: "g1", ends_on: "2030-01-01", closing_on: null, account_limit: 5, device_limit: 3, places_left: 2, invite_days: 7,
    accounts: [
      { label: "A1", role: "member", joined_on: "2026-11-01", devices },
      { label: "L1", role: "leader", joined_on: "2026-10-27", devices: [] },
    ],
    invites: [], inspection_limit: 2, inspections_in_use: 0, inspection_days: 7, leader_key: PUBLIC, ...over,
  };
}

type Sent = { method: string; path: string; body: unknown };

async function backend(page: Page, body: Record<string, unknown>) {
  const sent: Sent[] = [];
  const state = { ...body };
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== "GET") sent.push({ method: req.method(), path, body: req.postDataJSON() });
    if (path === "/api/me") return route.fulfill({ json: ME });
    if (path === "/api/group") return route.fulfill({ json: state });
    if (path === "/api/group/key") {
      state.leader_key = (req.postDataJSON() as { public_key: string }).public_key;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/passkeys") return route.fulfill({ json: [] });
    if (req.method() !== "GET") return route.fulfill({ json: { ok: true } });
    return route.fulfill({ json: [] });
  });
  return sent;
}

const withKey = (page: Page, key = KEY) => page.addInitScript((k) => localStorage.setItem("vessel-leader-key", k), key);

test("nothing about inspections until the maintainer offers them", async ({ page }) => {
  await backend(page, group([device("d-1", "手機")], { inspection_limit: 0 }));
  await withKey(page);
  await page.goto("/group/");
  await expect(page.getByTestId("group-account-A1")).toContainText("手機");
  await expect(page.getByTestId("group-inspect")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /請成員檢測/ })).toHaveCount(0);
});

test("a leader makes a key, keeps it, and can then ask", async ({ page }) => {
  const sent = await backend(page, group([device("d-1", "手機")], { leader_key: null }));
  await page.goto("/group/");
  const card = page.getByTestId("group-key");
  await expect(page.getByRole("button", { name: /請成員檢測/ })).toHaveCount(0);
  await card.getByRole("button", { name: "產生鑰匙" }).click();
  const shown = await card.getByTestId("group-key-value").textContent();
  const put = sent.find((s) => s.path === "/api/group/key")!;
  // the portal gets the public half, the browser keeps the private half
  expect((put.body as { public_key: string }).public_key).toBe(Buffer.from(x25519.getPublicKey(Buffer.from(shown!, "base64"))).toString("base64"));
  expect(await page.evaluate(() => localStorage.getItem("vessel-leader-key"))).toBe(shown);
  await expect(card).toContainText("請複製到密碼管理工具");
  await page.getByRole("button", { name: "請成員檢測: A1 的 手機" }).click();
  await expect.poll(() => sent.some((s) => s.method === "POST" && s.path === "/api/group/devices/d-1/inspection")).toBe(true);
});

test("a key missing from this browser is pasted back, and a wrong one is refused", async ({ page }) => {
  await backend(page, group([device("d-1", "手機")]));
  await page.goto("/group/");
  const card = page.getByTestId("group-key");
  await expect(card).toContainText("瀏覽器裡沒有你的鑰匙");
  await card.getByTestId("group-key-input").fill(OTHER);
  await card.getByRole("button", { name: "使用這把鑰匙" }).click();
  await expect(card.getByRole("alert")).toContainText("鑰匙不符");
  await card.getByTestId("group-key-input").fill(KEY);
  await card.getByRole("button", { name: "使用這把鑰匙" }).click();
  await expect(card).toContainText("瀏覽器裡有你的鑰匙");
  await expect(page.getByRole("button", { name: "請成員檢測: A1 的 手機" })).toBeVisible();
});

test("a request waits, has a message to send, and can be withdrawn", async ({ page }) => {
  const sent = await backend(page, group([device("d-1", "手機", { ...base, status: "requested", until: "2026-11-17" })], { inspections_in_use: 1 }));
  await withKey(page);
  await page.goto("/group/");
  const it = page.getByTestId("group-inspection-d-1");
  await expect(it).toContainText("等待成員回應");
  await expect(page.getByTestId("group-inspect-limit")).toHaveText("同時最多可以請 2 台裝置檢測，目前用了 1 台。");
  await page.getByRole("button", { name: "撤回請求: A1 的 手機" }).click();
  await expect.poll(() => sent.some((s) => s.method === "DELETE" && s.path === "/api/group/devices/d-1/inspection")).toBe(true);
});

test("a summary shows the verdict and the kinds, and nothing of the sites", async ({ page }) => {
  await backend(page, group([device("d-1", "手機", {
    ...base, status: "active", started_at: "2026-11-08T00:00:00Z", ends_at: "2026-11-15T00:00:00Z", summary: summary(THREAT),
  })], { inspections_in_use: 1 }));
  await withKey(page);
  await page.goto("/group/");
  const shown = page.getByTestId("group-summary");
  await expect(shown).toHaveAttribute("data-verdict", "threat");
  await expect(shown).toContainText("發現已知威脅");
  await expect(shown).toContainText("跟蹤軟體");
  await expect(shown).toContainText("40 / 72 小時");
  await expect(page.getByTestId("group-inspection-d-1")).toContainText("進行中，第");
  // a member's agreed inspection is theirs to end
  await expect(page.getByRole("button", { name: /撤回請求/ })).toHaveCount(0);
});

test("an inspection ended early says how many days it ran", async ({ page }) => {
  await backend(page, group([device("d-1", "手機", {
    ...base, status: "ended", started_at: "2026-11-01T00:00:00Z", ends_at: "2026-11-08T00:00:00Z", stopped_at: "2026-11-03T12:00:00Z",
    ended_early: true, report_until: "2026-11-10", summary: summary(CLEAN),
  })]));
  await withKey(page);
  await page.goto("/group/");
  const it = page.getByTestId("group-inspection-d-1");
  await expect(it).toContainText("實際檢測 3 天");
  await expect(page.getByTestId("group-summary")).toContainText("沒有發現已知的威脅指標");
  await expect(page.getByRole("button", { name: "再請成員檢測一次: A1 的 手機" })).toBeVisible();
});

test("results this leader cannot open say why", async ({ page }) => {
  await backend(page, group([
    device("d-1", "手機", { ...base, status: "active", ends_at: "2026-11-15T00:00:00Z", summary: null }),
    // sealed to another key of this leader's
    device("d-2", "筆電", { ...base, status: "ended", report_until: "2026-11-20", summary: { key: OTHER, sealed: seal(CLEAN, "vessel-inspection-summary", OTHER) } }),
    // a report's sealing does not open as a summary
    device("d-3", "平板", { ...base, status: "ended", report_until: "2026-11-20", summary: summary(CLEAN, "vessel-inspection-report") }),
  ]));
  await withKey(page);
  await page.goto("/group/");
  await expect(page.getByTestId("group-inspection-d-1")).toContainText("成員同意時你還沒有鑰匙");
  await expect(page.getByTestId("group-inspection-d-2").getByTestId("group-summary-locked")).toBeVisible();
  await expect(page.getByTestId("group-inspection-d-3").getByTestId("group-summary-locked")).toBeVisible();
  await expect(page.getByTestId("group-summary")).toHaveCount(0);
});

test("a no and a deletion can be cleared off the page", async ({ page }) => {
  const sent = await backend(page, group([
    device("d-1", "手機", { ...base, status: "declined", until: "2026-11-17" }),
    device("d-2", "筆電", { ...base, status: "deleted", until: "2026-11-17" }),
  ]));
  await withKey(page);
  await page.goto("/group/");
  await expect(page.getByTestId("group-inspection-d-1")).toContainText("成員沒有同意");
  await expect(page.getByTestId("group-inspection-d-2")).toContainText("成員已刪除結果");
  await page.getByRole("button", { name: "移除紀錄: A1 的 筆電" }).click();
  await expect.poll(() => sent.some((s) => s.method === "DELETE" && s.path === "/api/group/devices/d-2/inspection")).toBe(true);
});

test("no more requests past the limit or while the group closes", async ({ page }) => {
  await backend(page, group([device("d-1", "手機"), device("d-2", "筆電")], { inspection_limit: 1, inspections_in_use: 1 }));
  await withKey(page);
  await page.goto("/group/");
  await expect(page.getByTestId("group-account-A1")).toContainText("筆電");
  await expect(page.getByRole("button", { name: /請成員檢測/ })).toHaveCount(0);
  await page.unroute("**/api/**");
  await backend(page, group([device("d-1", "手機")], { closing_on: "2026-12-01" }));
  await page.reload();
  await expect(page.getByTestId("group-closing")).toBeVisible();
  await expect(page.getByRole("button", { name: /請成員檢測/ })).toHaveCount(0);
});
