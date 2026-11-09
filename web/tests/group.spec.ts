import { type Page, expect, test } from "@playwright/test";

const ME = { created_on: "2026-10-27", last_login_on: "2026-11-05", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 0,
  group: { role: "leader", label: "L1", device_revoked_on: null } };
const device = (id: string, name: string, issues: string[] = []) => ({
  id, name, region: "jp", dns_filter: "malware", status: "active", expires_on: "2030-01-01", issues,
});
const GROUP = {
  code: "g1", ends_on: "2030-01-01", closing_on: null, account_limit: 5, device_limit: 3, places_left: 2, invite_days: 7,
  accounts: [
    { label: "A1", role: "member", joined_on: "2026-11-01", devices: [device("d-1", "手機"), device("d-2", "筆電", ["new_config"])] },
    { label: "A2", role: "member", joined_on: "2026-11-02", devices: [] },
    { label: "L1", role: "leader", joined_on: "2026-10-27", devices: [] },
  ],
  invites: [{ id: 7, label: "A3", created_at: "2026-11-05T00:00:00Z", expires_at: "2026-11-12T00:00:00Z", expired: false }],
};

type Sent = { method: string; path: string; body: unknown };

async function backend(page: Page, opts: { group?: object; me?: object; groupError?: string; removeError?: string; inviteError?: string } = {}) {
  const sent: Sent[] = [];
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== "GET") sent.push({ method: req.method(), path, body: req.postDataJSON() });
    if (path === "/api/me") return route.fulfill({ json: { ...ME, ...opts.me } });
    if (path === "/api/group") {
      return opts.groupError
        ? route.fulfill({ status: 403, json: { error: opts.groupError } })
        : route.fulfill({ json: { ...GROUP, ...opts.group } });
    }
    if (path === "/api/group/invites" && req.method() === "POST") {
      if (opts.inviteError) return route.fulfill({ status: 409, json: { error: opts.inviteError } });
      const labels = (req.postDataJSON() as { labels: string[] }).labels;
      return route.fulfill({ json: { days: 7, invites: labels.map((label, i) => ({
        id: 20 + i, label, code: `AAAA-BBBB-CCCC-000${i}`, expires_at: "2026-11-16T00:00:00Z" })) } });
    }
    if (path === "/api/group/members/remove" && opts.removeError) return route.fulfill({ status: 403, json: { error: opts.removeError } });
    if (path === "/api/devices") return route.fulfill({ json: [] });
    if (path === "/api/passkeys") return route.fulfill({ json: [] });
    if (req.method() !== "GET") return route.fulfill({ json: { ok: true } });
    return route.fulfill({ json: [] });
  });
  return sent;
}

test("a leader sees the group, what needs attention and every device", async ({ page }) => {
  await backend(page);
  await page.goto("/group/");
  await expect(page.getByRole("heading", { level: 1, name: "管理團體" })).toBeVisible();
  await expect(page.getByTestId("group-places")).toHaveText("2 / 5 位，還可以發放 2 組");
  await expect(page.getByTestId("group-leaders")).toContainText("L1");
  const needs = page.getByTestId("group-needs");
  await expect(needs).toContainText("A1 的 筆電");
  await expect(needs).toContainText("設定需要更新");
  await expect(needs).toContainText("不代表裝置一定遭到入侵");
  await expect(page.getByTestId("group-account-A1")).toContainText("手機");
  // a leader's place cannot be taken back from this page
  await expect(page.getByTestId("group-account-L1").getByRole("button", { name: "回收名額" })).toHaveCount(0);
  await expect(page.getByTestId("group-ending")).toHaveCount(0);
});

test("a member who opens the address goes to their devices", async ({ page }) => {
  await backend(page, { groupError: "not_leader", me: { group: { role: "member", label: "A1", device_revoked_on: null } } });
  await page.goto("/group/");
  await expect(page).toHaveURL(/\/devices\/$/);
});

test("the devices page links to the group for a leader only", async ({ page }) => {
  await backend(page);
  await page.goto("/devices/");
  await expect(page.getByRole("link", { name: "管理團體" })).toBeVisible();
  await page.unroute("**/api/**");
  await backend(page, { me: { group: null } });
  await page.goto("/devices/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "管理團體" })).toHaveCount(0);
});

test("revoking takes a deliberate second step", async ({ page }) => {
  const sent = await backend(page);
  await page.goto("/group/");
  await page.getByRole("button", { name: "撤銷: A1 的 手機" }).click();
  const dialog = page.getByTestId("group-confirm");
  await expect(dialog).toContainText("撤銷 A1 的 手機？");
  await expect(dialog).toContainText("不能曝光");
  // a stray Enter lands on backing out, and the button that acts is off
  await expect(dialog.getByRole("button", { name: "先不要" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "撤銷這台裝置" })).toBeDisabled();
  await dialog.getByRole("button", { name: "先不要" }).click();
  await expect(dialog).toHaveCount(0);
  expect(sent).toEqual([]);

  await page.getByRole("button", { name: "撤銷: A1 的 手機" }).click();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "撤銷這台裝置" }).click();
  await expect(dialog).toHaveCount(0);
  expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual(["DELETE /api/group/devices/d-1"]);
});

test("Escape backs out of revoking", async ({ page }) => {
  const sent = await backend(page);
  await page.goto("/group/");
  await page.getByRole("button", { name: "撤銷: A1 的 手機" }).click();
  // focus is in the dialog once it is modal: a key pressed earlier has nothing to close
  await expect(page.getByTestId("group-confirm").getByRole("button", { name: "先不要" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("group-confirm")).toHaveCount(0);
  expect(sent).toEqual([]);
});

test("taking back a place asks who it is when the sign-in is old", async ({ page }) => {
  await backend(page, { removeError: "verify_required" });
  await page.goto("/group/");
  await page.getByTestId("group-account-A2").getByRole("button", { name: "回收名額" }).click();
  const dialog = page.getByTestId("group-confirm");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "回收名額" }).click();
  await expect(page.getByTestId("reverify")).toBeVisible();
});

test("taking back a place sends the alias", async ({ page }) => {
  const sent = await backend(page);
  await page.goto("/group/");
  await page.getByTestId("group-account-A2").getByRole("button", { name: "回收名額" }).click();
  const dialog = page.getByTestId("group-confirm");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "回收名額" }).click();
  await expect(dialog).toHaveCount(0);
  expect(sent).toEqual([{ method: "POST", path: "/api/group/members/remove", body: { label: "A2" } }]);
});

test("invites start from the next free alias and show each code once", async ({ page }) => {
  const sent = await backend(page);
  await page.goto("/group/");
  await page.getByRole("button", { name: "發放邀請碼" }).click();
  const form = page.getByTestId("group-invite-form");
  await expect(form.getByRole("textbox").first()).toHaveValue("A4");
  await form.getByRole("button", { name: "再加一組" }).click();
  await expect(form.getByRole("textbox").nth(1)).toHaveValue("A5");
  // two places left: there is no third row to add
  await expect(form.getByRole("button", { name: "再加一組" })).toHaveCount(0);
  await form.getByRole("button", { name: "產生邀請碼" }).click();
  await expect(page.getByTestId("group-invites-made")).toContainText("只顯示這一次");
  await expect(page.getByTestId("group-invite-code")).toHaveText(["AAAA-BBBB-CCCC-0000", "AAAA-BBBB-CCCC-0001"]);
  expect(sent[0]).toEqual({ method: "POST", path: "/api/group/invites", body: { labels: ["A4", "A5"] } });
  await page.getByRole("button", { name: "我已經傳給成員了" }).click();
  await expect(page.getByTestId("group-invites-made")).toHaveCount(0);
});

test("a taken alias says so and keeps the form", async ({ page }) => {
  await backend(page, { inviteError: "label_in_use" });
  await page.goto("/group/");
  await page.getByRole("button", { name: "發放邀請碼" }).click();
  await page.getByRole("button", { name: "產生邀請碼" }).click();
  await expect(page.getByTestId("group-invites").getByRole("alert")).toHaveText("這個代稱已經有人使用，請換一個。");
  await expect(page.getByTestId("group-invite-form")).toBeVisible();
});

test("with no places left the page says how to free one", async ({ page }) => {
  await backend(page, { group: { places_left: 0 } });
  await page.goto("/group/");
  await expect(page.getByRole("button", { name: "發放邀請碼" })).toHaveCount(0);
  await expect(page.getByTestId("group-invites")).toContainText("名額已經發完");
});

test("an unused invite can be withdrawn", async ({ page }) => {
  const sent = await backend(page);
  await page.goto("/group/");
  await page.getByRole("button", { name: "撤回: A3" }).click();
  await expect.poll(() => sent.map((s) => `${s.method} ${s.path}`)).toEqual(["DELETE /api/group/invites/7"]);
});

test("the message to copy has what to do and no numbers", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await backend(page);
  await page.goto("/group/");
  await page.getByRole("button", { name: "複製訊息: A1 的 筆電" }).click();
  await expect(page.getByTestId("group-needs").getByRole("button", { name: "複製訊息: A1 的 筆電" })).toHaveText("已複製");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("A1");
  expect(text).toContain("筆電");
  expect(text).toContain("/devices/");
});

test("a group about to end says so at the top", async ({ page }) => {
  const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await backend(page, { group: { ends_on: soon } });
  await page.goto("/group/");
  await expect(page.getByTestId("group-ending")).toContainText("需要延長");
});

test("the page reads in the other languages", async ({ page }) => {
  await backend(page);
  await page.goto("/en/group/");
  await expect(page.getByRole("heading", { level: 1, name: "Manage group" })).toBeVisible();
  await expect(page.getByTestId("group-needs")).toContainText("Needs a new configuration");
  await page.goto("/zh-cn/group/");
  await expect(page.getByRole("heading", { level: 1, name: "管理团体" })).toBeVisible();
});

test("a closing group says when, and takes no more invites", async ({ page }) => {
  await backend(page, { group: { closing_on: "2030-02-01" } });
  await page.goto("/group/");
  await expect(page.getByTestId("group-closing")).toContainText("都會刪除");
  await expect(page.getByTestId("group-ending")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "發放邀請碼" })).toHaveCount(0);
  await expect(page.getByTestId("group-invites")).toContainText("即將結束");
});
