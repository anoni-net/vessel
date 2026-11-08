import { type Page, type Route, expect, test } from "@playwright/test";
import axe from "axe-core";
import { FEEDBACK_ENDPOINT } from "../src/feedback.ts";

// WCAG 2.4.3: when what had focus goes away (the page after a link inside the site, a step of a form, a deleted
// item), focus moves on to where the person would read next instead of falling back to the body. axe checks each
// state these lead to as well, since a11y.spec.ts only sees how each page first loads.

const ME = { created_on: "2026-10-27", last_login_on: "2026-10-27", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 0 };
const DEVICE = { id: "d-a", name: "phone", region: "sg", dns_filter: "ads", status: "active", created_on: "2026-10-28",
  expires_on: "2026-12-04", used_bytes: 3e9, blocked: 12, connected: true, ipv6: false, moved_until: null };
const NODE = {
  interface: { Address: "10.8.1.7/32", DNS: "10.8.1.254", MTU: "1280", Jc: "5", Jmin: "20", Jmax: "90", S1: "12", I1: "<r 2><b 0x0100>" },
  peer: { PublicKey: "srvkey", AllowedIPs: "0.0.0.0/0, ::/0", Endpoint: "198.51.100.1:443", PersistentKeepalive: "25-35" },
};
const INVITES = { per_account: 2, used: 0, left: 1, reason: null, eligible_on: "2026-10-15", days: 7,
  open: [{ id: 1, created_at: "2026-11-04T01:00:00Z", expires_at: "2026-11-11T01:00:00Z" }] };

type Handler = (route: Route) => unknown;
const json = (body: unknown, status = 200): Handler => (route) => route.fulfill({ status, json: body });

async function mockApi(page: Page, handlers: Record<string, Handler>) {
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const handler = handlers[`${req.method()} ${new URL(req.url()).pathname}`];
    return handler ? handler(route) : route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}
const signedOut = { "GET /api/me": json({ error: "signed_out" }, 401) };

async function noViolations(page: Page) {
  await page.evaluate(axe.source);
  const found = await page.evaluate(async () => {
    const res = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  });
  expect(found).toEqual([]);
}

/** Follow a link from the keyboard, as someone without a mouse does. */
async function press(page: Page, link: ReturnType<Page["getByRole"]>) {
  await link.focus();
  await page.keyboard.press("Enter");
}

test("the first page leaves focus to the browser", async ({ page }) => {
  await mockApi(page, signedOut);
  await page.goto("/faq/");
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test("a link inside the page starts the next page at its heading", async ({ page }) => {
  await mockApi(page, signedOut);
  await page.goto("/");
  await press(page, page.locator("main").getByRole("link", { name: /VPN 入門/ }).first());
  await expect(page).toHaveURL(/\/learn\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  // and Tab goes on from there, into the page, not back to its top
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("main"))).toBe(true);
});

test("a link in the footer does too, and the heading shows no ring", async ({ page }) => {
  await mockApi(page, signedOut);
  await page.goto("/faq/");
  await press(page, page.locator("footer").getByRole("link", { name: "VPN 入門" }));
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toBeFocused();
  await expect(h1).toHaveText("VPN 入門");
  expect(await h1.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe("none");
});

test("a link to a part of another page starts at that part", async ({ page }) => {
  await mockApi(page, signedOut);
  await page.goto("/redeem/");
  await press(page, page.getByRole("link", { name: "所在地限制 VPN 時，使用 Vessel 安全嗎？" }));
  await expect(page).toHaveURL(/\/faq\/#q-risky$/);
  await expect(page.locator("#q-risky")).toBeFocused();
});

test("a page that loads its data starts at its heading once it is there", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await mockApi(page, {
    "GET /api/me": async (route) => { await held; await route.fulfill({ json: ME }); },
    "GET /api/devices": json([DEVICE]),
    "GET /api/passkeys": json([]),
    "GET /api/invites": json(INVITES),
    "GET /api/usage/months": json({ filter: "ads", months: [] }),
  });
  await page.goto("/faq/");
  await press(page, page.locator("footer").getByRole("link", { name: "VPN 入門" }));
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await page.evaluate(() => { history.pushState(null, "", "/account/"); dispatchEvent(new PopStateEvent("popstate")); });
  release();
  await expect(page.getByRole("heading", { level: 1, name: "帳號" })).toBeFocused();
});

test("a busy button keeps focus, and an error leaves it there", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  let sent = 0;
  await mockApi(page, { ...signedOut, "POST /api/login": async (route) => { sent++; await held; await route.fulfill({ status: 401, json: { error: "invalid_number" } }); } });
  await page.goto("/login/");
  await page.getByLabel("帳號號碼").fill("4821 0937 5564 2018");
  const button = page.locator("form").getByRole("button", { name: /登入/ });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button).toBeDisabled();
  await expect(button).toBeFocused();
  // pressed again while busy: nothing more is sent
  await page.keyboard.press("Enter");
  release();
  await expect(page.getByRole("alert")).toHaveText("帳號號碼不正確。");
  await expect(button).toBeFocused();
  expect(sent).toBe(1);
  await noViolations(page);
});

test("each step of adding a device starts at its heading", async ({ page }) => {
  await mockApi(page, {
    "GET /api/me": json(ME),
    "GET /api/devices": json([]),
    "GET /api/regions": json([{ id: "sg", open: true }]),
    "GET /api/relays": json([]),
    "POST /api/devices": json({ id: "d-abcdef123456", status: "active", config: NODE }),
  });
  await page.goto("/devices/new/");
  const h1 = page.getByRole("heading", { level: 1 });
  await press(page, page.getByRole("button", { name: "已經安裝，下一步" }));
  await expect(h1).toHaveText("選擇城市");
  await expect(h1).toBeFocused();
  await noViolations(page);
  await press(page, page.getByRole("button", { name: /新加坡/ }));
  await expect(h1).toHaveText("替裝置取個名稱");
  await expect(h1).toBeFocused();
  await noViolations(page);
  await page.getByLabel("替裝置取個名稱").fill("手機");
  await page.keyboard.press("Enter");
  await expect(h1).toHaveText("額外的防護");
  await expect(h1).toBeFocused();
  await noViolations(page);
  await press(page, page.getByRole("button", { name: "產生設定檔" }));
  await expect(h1).toHaveText("匯入 AmneziaWG");
  await expect(h1).toBeFocused();
  await noViolations(page);
});

test("after redeeming, the number and then the passkey offer start at their headings", async ({ page }) => {
  await mockApi(page, { ...signedOut, "POST /api/redeem": json({ account_number: "4821093755642018" }) });
  await page.goto("/redeem/");
  await page.getByLabel("邀請碼").fill("abcd-efgh-jkmn-pqrs");
  await page.keyboard.press("Enter");
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveText("帳號建立完成");
  await expect(h1).toBeFocused();
  await noViolations(page);
  await page.getByLabel("我已經把號碼存在安全的地方").check();
  await press(page, page.getByRole("button", { name: "繼續" }));
  await expect(h1).toHaveText("加上 passkey");
  await expect(h1).toBeFocused();
  await noViolations(page);
});

test("after deleting a device, focus is on the page's heading", async ({ page }) => {
  let deleted = false;
  await mockApi(page, {
    "GET /api/me": json(ME),
    "GET /api/devices": (route) => route.fulfill({ json: deleted ? [] : [DEVICE] }),
    "GET /api/regions": json([{ id: "sg", open: true }]),
    "DELETE /api/devices/d-a": (route) => { deleted = true; return route.fulfill({ json: { ok: true } }); },
  });
  await page.goto("/devices/");
  page.on("dialog", (d) => d.accept());
  await press(page, page.getByTestId("device-list").getByRole("button", { name: "刪除" }));
  await expect(page.getByTestId("device-list").getByText("phone")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "我的裝置" })).toBeFocused();
});

test("a new invite takes focus, and withdrawing one leaves it on the invites' heading", async ({ page }) => {
  let state = INVITES;
  await mockApi(page, {
    "GET /api/me": json(ME),
    "GET /api/devices": json([]),
    "GET /api/passkeys": json([]),
    "GET /api/usage/months": json({ filter: "ads", months: [] }),
    "GET /api/invites": (route) => route.fulfill({ json: state }),
    "POST /api/invites": (route) => {
      state = { ...INVITES, left: 0, reason: "none_left" as never, open: [...INVITES.open, { id: 2, created_at: "2026-11-08T01:00:00Z", expires_at: "2026-11-15T01:00:00Z" }] };
      return route.fulfill({ json: { code: "ABCD-EFGH-JKMN-PQRS", id: 2, created_at: "2026-11-08T01:00:00Z", expires_at: "2026-11-15T01:00:00Z" } });
    },
    "DELETE /api/invites/1": (route) => {
      state = { ...state, open: state.open.filter((i) => i.id !== 1) };
      return route.fulfill({ json: state });
    },
  });
  await page.goto("/account/");
  // the last one: the button goes away with it
  await press(page, page.getByRole("button", { name: "產生邀請碼" }));
  await expect(page.getByTestId("invite-made")).toBeFocused();
  await expect(page.getByRole("button", { name: "產生邀請碼" })).toHaveCount(0);
  await noViolations(page);
  page.on("dialog", (d) => d.accept());
  await press(page, page.getByTestId("invites-open").getByRole("button", { name: "作廢" }).first());
  await expect(page.getByTestId("invites-open").locator("li")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "邀請朋友" })).toBeFocused();
});

test("after sending feedback, focus is on the thanks", async ({ page }) => {
  await mockApi(page, signedOut);
  await page.route(FEEDBACK_ENDPOINT, (route) => route.fulfill({ status: 200, json: {} }));
  await page.goto("/feedback/");
  await page.getByLabel("連不上或常斷線").check();
  await page.getByLabel("發生了什麼事？").fill("每天晚上都會斷線好幾次");
  await press(page, page.getByRole("button", { name: "送出" }));
  await expect(page.getByTestId("feedback-sent")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "收到了，謝謝" })).toBeFocused();
  await noViolations(page);
});
