import { type Page, type Route, expect, test } from "@playwright/test";

// The account page's invites (pages/invites.tsx) and the redeem link they make (toomore/anoni-net-ws#458).

const ME = { created_on: "2026-10-01", last_login_on: "2026-11-04", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 1e9 };
const BASE = { per_account: 1, used: 0, left: 1, reason: null, eligible_on: "2026-10-15", days: 7, open: [] };
type Invites = Omit<typeof BASE, "reason" | "open"> & { reason: string | null; open: { id: number; created_at: string; expires_at: string }[] };

async function account(page: Page, invites: Invites, handlers: Record<string, (route: Route) => unknown> = {}) {
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const key = `${req.method()} ${new URL(req.url()).pathname}`;
    if (handlers[key]) return handlers[key](route);
    if (key === "GET /api/me") return route.fulfill({ json: ME });
    if (key === "GET /api/invites") return route.fulfill({ json: invites });
    if (key === "GET /api/passkeys") return route.fulfill({ json: [] });
    if (key === "GET /api/usage/months") return route.fulfill({ json: { filter: "malware", months: [] } });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}

test("off for everyone: the account page says nothing about invites", async ({ page }) => {
  await account(page, { ...BASE, per_account: 0, left: 0, reason: "off" });
  await page.goto("/account/");
  await expect(page.getByRole("heading", { name: "passkey" })).toBeVisible();
  await expect(page.getByTestId("invites")).toHaveCount(0);
});

test("a failed load leaves the rest of the page alone", async ({ page }) => {
  await account(page, BASE, { "GET /api/invites": (route) => route.fulfill({ status: 500, json: { error: "unknown" } }) });
  await page.goto("/account/");
  await expect(page.getByRole("heading", { name: "passkey" })).toBeVisible();
  await expect(page.getByTestId("invites")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("why none can be made yet", async ({ page }) => {
  for (const [reason, text] of [
    ["too_new", "帳號建立滿 14 天之後可以邀請朋友（2026/10/15 起）。"],
    ["not_connected", "有一台裝置連上 Vessel 之後，就可以邀請朋友。"],
    ["none_left", "你的邀請名額已經用完了。"],
    ["full", "目前暫停接受新帳號，之後再開放邀請。"],
  ] as const) {
    await page.unrouteAll();
    await account(page, { ...BASE, left: 0, reason, used: reason === "none_left" ? 1 : 0 });
    await page.goto("/account/");
    const box = page.getByTestId("invites");
    await expect(box.getByTestId("invites-wait")).toHaveText(text);
    await expect(box.getByRole("button", { name: "產生邀請碼" })).toHaveCount(0);
  }
  await expect(page.getByTestId("invites-used")).toHaveCount(0);
});

test("make one, copy the message with the link, withdraw it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let state: Invites = { ...BASE };
  const seen: (string | undefined)[] = [];
  const made = { id: 9, created_at: "2026-11-04T01:00:00Z", expires_at: "2026-11-11T01:00:00Z" };
  await account(page, BASE, {
    "GET /api/invites": (route) => route.fulfill({ json: state }),
    "POST /api/invites": (route) => {
      seen.push(route.request().headers()["x-vessel-request"]);
      state = { ...BASE, left: 0, reason: "none_left", open: [made] };
      return route.fulfill({ json: { code: "ABCD-EFGH-JKMN-PQRS", ...made } });
    },
    "DELETE /api/invites/9": (route) => {
      state = { ...BASE };
      return route.fulfill({ json: state });
    },
  });
  await page.goto("/account/");
  const box = page.getByTestId("invites");
  await expect(box.getByTestId("invites-left")).toHaveText("還可以邀請 1 位");
  await box.getByRole("button", { name: "產生邀請碼" }).click();
  await expect(box.getByTestId("invite-code")).toHaveText("ABCD-EFGH-JKMN-PQRS");
  await expect(box.getByTestId("invites-wait")).toHaveCount(0);
  expect(seen).toEqual(["1"]);
  await expect(box.getByTestId("invite-made")).toContainText("/redeem/#ABCD-EFGH-JKMN-PQRS");
  await expect(box.getByTestId("invite-made")).toContainText("邀請碼只會顯示這一次，請現在傳給對方。2026/11/11 前有效。");
  await box.getByRole("button", { name: "複製邀請訊息" }).click();
  await expect(box.getByRole("button", { name: "已複製" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("/redeem/#ABCD-EFGH-JKMN-PQRS");
  expect(copied).toContain("邀請碼：ABCD-EFGH-JKMN-PQRS（7 天內有效，只能使用一次）");
  // the list shows when it was made and until when, never the code again
  const open = box.getByTestId("invites-open");
  await expect(open).toContainText("2026/11/04 產生，2026/11/11 到期");
  await expect(box.getByRole("button", { name: "產生邀請碼" })).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await open.getByRole("button", { name: "作廢" }).click();
  await expect(open).toHaveCount(0);
  await expect(box.getByTestId("invites-left")).toHaveText("還可以邀請 1 位");
});

test("how many used them, as a number only", async ({ page }) => {
  await account(page, { ...BASE, per_account: 2, used: 1, left: 1 });
  await page.goto("/account/");
  await expect(page.getByTestId("invites-used")).toHaveText("已經有 1 位用了你的邀請碼。");
});

test("the link fills in the code on the redeem page and leaves the address bar clean", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
  await page.goto("/redeem/#abcd-efgh-jkmn-pqrs");
  await expect(page.getByLabel("邀請碼")).toHaveValue("ABCD-EFGH-JKMN-PQRS");
  expect(new URL(page.url()).hash).toBe("");
  await page.goto("/en/redeem/#ABCDEFGHJKMNPQRS");
  await expect(page.getByLabel("Invite code")).toHaveValue("ABCD-EFGH-JKMN-PQRS");
});
