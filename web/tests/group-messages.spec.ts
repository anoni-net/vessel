import { type Page, expect, test } from "@playwright/test";

// The leaders' announcements to their group (pages/group-messages.tsx), and how they show in an inbox.

const ME = { created_on: "2026-10-27", last_login_on: "2026-11-16", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 0,
  group: { role: "leader", label: "L1", device_revoked_on: null } };
const GROUP = {
  code: "g1", ends_on: "2030-01-01", closing_on: null, account_limit: 5, device_limit: 3, places_left: 2, invite_days: 7,
  accounts: [{ label: "L1", role: "leader", joined_on: "2026-10-27", devices: [] }], invites: [],
  message_limit: 2, message_days: 30,
};
const POSTED = { id: 5, texts: { "zh-TW": { title: "週六聚會改到線上", body: "連結晚點貼在群組。" } },
  created_at: "2026-11-16T03:00:00Z", expires_on: "2026-12-16" };

async function backend(page: Page, messages: object[] | undefined) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  let list = messages;
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== "GET") sent.push({ method: req.method(), path, body: req.postDataJSON() });
    if (path === "/api/me") return route.fulfill({ json: ME });
    if (path === "/api/group") return route.fulfill({ json: list === undefined ? GROUP : { ...GROUP, messages: list } });
    if (path === "/api/group/messages" && req.method() === "POST") {
      list = [POSTED, ...(list ?? [])];
      return route.fulfill({ json: { messages: list } });
    }
    if (path.startsWith("/api/group/messages/") && req.method() === "DELETE") {
      list = (list ?? []).filter((m) => `/api/group/messages/${(m as { id: number }).id}` !== path);
      return route.fulfill({ json: { messages: list } });
    }
    if (path === "/api/passkeys") return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });
  return sent;
}

test("a leader writes one in the page's language, sees it, and takes it down", async ({ page }) => {
  const sent = await backend(page, []);
  await page.goto("/group/");
  const box = page.getByTestId("group-messages");
  await expect(box).toContainText("最多同時 2 則，每則保留 30 天");
  await box.getByRole("button", { name: "寫一則公告" }).click();
  await box.getByLabel("標題").fill("週六聚會改到線上");
  await box.getByLabel("內容").fill("連結晚點貼在群組。");
  await box.getByRole("button", { name: "發布公告" }).click();
  await expect(box.getByTestId("group-message-form")).toHaveCount(0);
  const list = box.getByTestId("group-messages-list");
  await expect(list.getByRole("heading", { name: "週六聚會改到線上" })).toBeVisible();
  await expect(list).toContainText("2026/11/16 發布，保留到 2026/12/16");
  expect(sent).toEqual([{ method: "POST", path: "/api/group/messages",
    body: { title: "週六聚會改到線上", body: "連結晚點貼在群組。", locale: "zh-TW" } }]);

  page.once("dialog", (d) => d.accept());
  await list.getByRole("button", { name: "刪除: 週六聚會改到線上" }).click();
  await expect(box.getByTestId("group-messages-list")).toHaveCount(0);
  expect(sent.at(-1)).toMatchObject({ method: "DELETE", path: "/api/group/messages/5" });
});

test("at the limit there is no form, only a note", async ({ page }) => {
  await backend(page, [POSTED, { ...POSTED, id: 4 }]);
  await page.goto("/group/");
  const box = page.getByTestId("group-messages");
  await expect(box.getByTestId("group-messages-full")).toHaveText("已經有 2 則公告，刪除一則之後才能再發布。");
  await expect(box.getByRole("button", { name: "寫一則公告" })).toHaveCount(0);
});

test("an older backend without announcements: no section", async ({ page }) => {
  await backend(page, undefined);
  await page.goto("/group/");
  await expect(page.getByRole("heading", { level: 1, name: "管理團體" })).toBeVisible();
  await expect(page.getByTestId("group-messages")).toHaveCount(0);
});

test("in a member's inbox, a leader's announcement says who it is from, in the language it was written in", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: { ...ME, group: { role: "member", label: "A1", device_revoked_on: null } } });
    if (path === "/api/inbox") {
      return route.fulfill({ json: { notes: [], messages: [{ ...POSTED, texts: { en: { title: "Meetup moves online", body: "See the chat." } },
        region: null, group: true, from_leader: true, unread: false }] } });
    }
    return route.fulfill({ json: { unread: 0 } });
  });
  await page.goto("/inbox/");
  const m = page.getByTestId("inbox-message");
  await expect(m).toContainText("團體負責人的公告");
  await expect(m.getByRole("heading", { name: "Meetup moves online" })).toBeVisible();
  await expect(m.locator("[lang]").first()).toHaveAttribute("lang", "en");
  await expect(m).not.toContainText("只有正體中文");
});
