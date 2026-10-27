import { type Page, type Route, expect, test } from "@playwright/test";

const ME = { created_on: "2026-10-27", last_login_on: "2026-10-27", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 4.2e9 };
const DEVICES = [
  { id: "d-aaa", name: "phone", region: "sg", dns_filter: "ads", status: "active", created_on: "2026-10-27", expires_on: "2026-11-26" },
  { id: "d-bbb", name: "laptop", region: "sg", dns_filter: "none", status: "suspended", created_on: "2026-10-27", expires_on: "2026-11-26" },
];

type Handler = (route: Route) => Promise<void> | void;

/** Mock /api/*. Every state-changing request must carry X-Vessel-Request. */
async function mockApi(page: Page, handlers: Record<string, Handler>) {
  const seen: string[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const key = `${req.method()} ${new URL(req.url()).pathname}`;
    seen.push(key);
    if (req.method() !== "GET") expect(req.headers()["x-vessel-request"]).toBe("1");
    const handler = handlers[key];
    if (handler) return handler(route);
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  return seen;
}

const json = (body: unknown, status = 200): Handler => (route) => route.fulfill({ status, json: body });
const signedIn = { "GET /api/me": json(ME), "GET /api/devices": json(DEVICES) };

async function noSideways(page: Page) {
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(w);
}

test("home page in three languages", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vessel");
  await expect(page.getByRole("link", { name: "我有邀請碼" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant-TW");
  await noSideways(page);
  await page.locator("footer").getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/$/);
  await expect(page.getByRole("link", { name: "I have an invite code" })).toBeVisible();
  await page.locator("footer").getByRole("link", { name: "简体中文" }).click();
  await expect(page.getByRole("link", { name: "我有邀请码" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans-CN");
});

test("frequently asked questions", async ({ page }) => {
  await page.goto("/");
  const faq = page.locator("#faq");
  await expect(faq.locator("details")).toHaveCount(11);
  const answer = faq.getByText("服務沒有你的 email，也只保存號碼的雜湊值");
  await expect(answer).toBeHidden();
  await faq.getByText("帳號號碼弄丟了怎麼辦？").click();
  await expect(answer).toBeVisible();
  await faq.getByRole("link", { name: "所有常見問題" }).click();
  await expect(page).toHaveURL(/\/faq\/$/);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["申請與帳號", "安裝與連線", "額度與規則", "隱私"]);
  await expect(page.locator("details")).toHaveCount(22);
  await noSideways(page);
  await page.locator("footer").getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/faq\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Frequently asked questions");
});

test("redeem shows the number once and gates continue", async ({ page }) => {
  await mockApi(page, { "POST /api/redeem": json({ account_number: "4821 0937 5564 2018" }), ...signedIn });
  await page.goto("/redeem/");
  await page.getByLabel("邀請碼").fill("abcd-efgh-jkmn-pqrs");
  await page.getByRole("button", { name: "兌換" }).click();
  await expect(page.getByTestId("account-number")).toHaveText("4821 0937 5564 2018");
  await noSideways(page);
  const go = page.getByRole("button", { name: /繼續|勾選/ });
  await expect(go).toBeDisabled();
  await page.getByLabel("我已經把號碼存在安全的地方").check();
  await page.getByRole("button", { name: "繼續" }).click();
  await expect(page).toHaveURL(/\/devices\/$/);
  await expect(page.getByRole("heading", { name: "我的裝置" })).toBeVisible();
});

test("redeem errors are translated", async ({ page }) => {
  await mockApi(page, { "POST /api/redeem": json({ error: "invalid_invite" }, 400) });
  await page.goto("/en/redeem/");
  await page.getByLabel("Invite code").fill("nope");
  await page.getByRole("button", { name: "Redeem" }).click();
  await expect(page.getByRole("alert")).toHaveText("The invite code is wrong, already used or expired.");
});

test("sign in, see devices and usage", async ({ page }) => {
  // /api/me answers signed_out until the sign-in succeeds, like the backend
  let inside = false;
  await mockApi(page, {
    ...signedIn,
    "POST /api/login": (route) => { inside = true; return route.fulfill({ json: { ok: true } }); },
    "GET /api/me": (route) => route.fulfill(inside ? { json: ME } : { status: 401, json: { error: "signed_out" } }),
  });
  await page.goto("/login/");
  await page.getByLabel("帳號號碼").fill("4821 0937 5564 2018");
  await page.getByRole("button", { name: "登入" }).last().click();
  const list = page.getByTestId("device-list");
  await expect(list.getByText("phone")).toBeVisible();
  await expect(list.getByText("使用中")).toBeVisible();
  await expect(list.getByText("本月額度已經用完，下個月自動恢復。")).toBeVisible();
  await expect(page.getByText("4.2 GB / 50 GB")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "8");
  await noSideways(page);
});

test("wrong account number", async ({ page }) => {
  await mockApi(page, { "POST /api/login": json({ error: "invalid_number" }, 401) });
  await page.goto("/login/");
  await page.getByLabel("帳號號碼").fill("0000 0000 0000 0000");
  await page.getByRole("button", { name: "登入" }).last().click();
  await expect(page.getByRole("alert")).toHaveText("帳號號碼不正確。");
});

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await mockApi(page, { "GET /api/me": json({ error: "signed_out" }, 401), "GET /api/devices": json({ error: "signed_out" }, 401) });
  await page.goto("/zh-cn/devices/");
  await expect(page).toHaveURL(/\/zh-cn\/login\/$/);
});

test("delete a device", async ({ page }) => {
  let deleted = false;
  await mockApi(page, {
    "GET /api/me": json(ME),
    "GET /api/devices": (route) => route.fulfill({ json: deleted ? DEVICES.slice(1) : DEVICES }),
    "DELETE /api/devices/d-aaa": (route) => { deleted = true; return route.fulfill({ json: { ok: true } }); },
  });
  await page.goto("/devices/");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "刪除" }).first().click();
  await expect(page.getByTestId("device-list").getByText("phone")).toHaveCount(0);
});

test("delete the account needs the checkbox", async ({ page }) => {
  const seen = await mockApi(page, { ...signedIn, "DELETE /api/account": json({ ok: true }) });
  await page.goto("/account/");
  const del = page.getByRole("button", { name: "刪除帳號" });
  await expect(del).toBeDisabled();
  await page.getByLabel("我了解，帳號刪除之後無法復原").check();
  await del.click();
  await expect(page).toHaveURL(/\/$/);
  expect(seen).toContain("DELETE /api/account");
});

test("unknown pages", async ({ page }) => {
  await page.goto("/nope/");
  await expect(page.getByRole("heading", { name: "找不到這一頁" })).toBeVisible();
});

test("pages run under the production CSP", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  const res = await page.goto("/");
  expect(res?.headers()["content-security-policy"]).toContain("default-src 'none'");
  await page.goto("/redeem/");
  await page.goto("/en/login/");
  expect(violations).toEqual([]);
});

test("the header links to the same page in the other languages", async ({ page, isMobile }) => {
  await page.goto("/faq/");
  const langs = page.getByRole("group", { name: "其他語言" });
  if (isMobile) {
    // no room next to the sign-in button on a phone; the footer still has them, and signed-in pages show them
    await expect(langs).toBeHidden();
    await mockApi(page, signedIn);
    await page.goto("/devices/");
  }
  await expect(langs.getByRole("link")).toHaveText(["简体", "EN"]);
  await langs.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(isMobile ? /\/en\/devices\/$/ : /\/en\/faq\/$/);
  await expect(page.getByRole("group", { name: "Other languages" }).getByRole("link")).toHaveText(["正體", "简体"]);
  await expect(page.locator("footer nav", { hasText: "Also in" }).getByRole("link")).toHaveText(["正體中文", "简体中文"]);
  await noSideways(page);
});

test("terms and privacy drafts in three languages", async ({ page }) => {
  for (const [path, heading, contact] of [
    ["/terms/", "禁止的用途", "whisper@anoni.net"],
    ["/zh-cn/privacy/", "保存的数据", "whisper@anoni.net"],
    ["/en/privacy/", "Backups", "whisper@anoni.net"],
    ["/en/terms/", "Prohibited uses", "whisper@anoni.net"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 2, name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: contact })).toHaveAttribute("href", "mailto:whisper@anoni.net");
    await noSideways(page);
  }
  // links inside the text keep the page's language
  await page.goto("/en/terms/");
  await expect(page.locator("main").getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "/en/privacy/");
});

test("invite codes and account numbers group themselves as you type", async ({ page }) => {
  await page.goto("/redeem/");
  const code = page.getByLabel("邀請碼");
  await code.pressSequentially("abcdefghjkmnpqrs");
  await expect(code).toHaveValue("ABCD-EFGH-JKMN-PQRS");
  // I, L and O read as 1, 1 and 0, like the backend; anything past 16 characters is dropped
  await code.fill("");
  await code.pressSequentially("iloa bcd efgh jkmn pqrs xyz");
  await expect(code).toHaveValue("110A-BCDE-FGHJ-KMNP");

  await page.goto("/login/");
  const number = page.getByLabel("帳號號碼");
  await number.fill("4821-0937 556420186666");
  await expect(number).toHaveValue("4821 0937 5564 2018");
  // fixing a digit in the middle keeps the caret where it was
  await number.fill("4821093755642018");
  await number.press("Home");
  for (let i = 0; i < 6; i++) await number.press("ArrowRight"); // after "4821 0"
  await number.press("Backspace");
  await expect(number).toHaveValue("4821 9375 5642 018");
  await number.press("7");
  await expect(number).toHaveValue("4821 7937 5564 2018");
  expect(await number.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(6);
});

test("the downloaded account number is marked as UTF-8", async ({ page }) => {
  await mockApi(page, { "POST /api/redeem": json({ account_number: "4821 0937 5564 2018" }) });
  await page.goto("/redeem/");
  await page.getByLabel("邀請碼").fill("abcd-efgh-jkmn-pqrs");
  await page.getByRole("button", { name: "兌換" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "下載" }).click()]);
  expect(download.suggestedFilename()).toBe("vessel-account.txt");
  const bytes = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c));
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(bytes.subarray(3).toString("utf8")).toBe("Vessel 帳號號碼\r\n4821 0937 5564 2018\r\n");
});

test("a signed-in visitor is not offered sign-in again", async ({ page }) => {
  let inside = true;
  await mockApi(page, {
    ...signedIn,
    "GET /api/me": (route) => route.fulfill(inside ? { json: ME } : { status: 401, json: { error: "signed_out" } }),
    "POST /api/logout": (route) => { inside = false; return route.fulfill({ json: { ok: true } }); },
  });
  await page.goto("/");
  const header = page.locator("header");
  await expect(header.getByRole("link", { name: "我的裝置" })).toBeVisible();
  await expect(header.getByRole("link", { name: "登入" })).toHaveCount(0);
  await expect(page.locator(".hero").getByRole("link", { name: "前往我的裝置" })).toBeVisible();
  await expect(page.locator(".hero").getByRole("link", { name: "我有邀請碼" })).toHaveCount(0);

  // the sign-in page sends you on, the redeem page warns before making a second account
  await page.goto("/login/");
  await expect(page).toHaveURL(/\/devices\/$/);
  await page.goto("/redeem/");
  await expect(page.getByText("你目前已經登入。兌換新的邀請碼會建立另一個帳號")).toBeVisible();

  // signing out brings the sign-in links back
  await page.goto("/account/");
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(header.getByRole("link", { name: "登入" })).toBeVisible();
  await expect(page.locator(".hero").getByRole("link", { name: "我有邀請碼" })).toBeVisible();
});

test("usage shows MB below 1 GB and GB from there on", async ({ page }) => {
  let used = 0;
  await mockApi(page, { "GET /api/me": (route) => route.fulfill({ json: { ...ME, used_bytes: used } }), "GET /api/devices": json(DEVICES) });
  for (const [bytes, shown, share] of [
    [0, "0 MB", "0%"],
    [300e3, "< 1 MB", "< 0.1%"],
    [17.4e6, "17 MB", "< 0.1%"],
    [380e6, "380 MB", "0.8%"],
    [999.6e6, "1 GB", "2%"],
    [4.24e9, "4.2 GB", "8.5%"],
    [9.97e9, "10 GB", "20%"],
    [23.4e9, "23 GB", "47%"],
    [51e9, "51 GB", "102%"],
  ] as const) {
    used = bytes;
    await page.goto("/devices/");
    await expect(page.getByText(`${shown} / 50 GB`, { exact: true })).toBeVisible();
    await expect(page.getByTestId("usage-percent")).toHaveText(share);
  }
  await page.goto("/en/devices/");
  await expect(page.getByText("51 GB / 50 GB", { exact: true })).toBeVisible();
  await expect(page.getByTestId("usage-percent")).toHaveText("102%");
});
