import { type Page, type Route, expect, test } from "@playwright/test";

const ME = { created_on: "2026-10-27", last_login_on: "2026-10-27", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 4.2e9 };
const DEVICES = [
  { id: "d-aaa", name: "phone", region: "sg", dns_filter: "ads", status: "active", created_on: "2026-10-27", expires_on: "2026-11-26", used_bytes: 3.1e9, blocked: 12, connected: true },
  { id: "d-bbb", name: "laptop", region: "sg", dns_filter: "none", status: "suspended", created_on: "2026-10-27", expires_on: "2026-11-26", used_bytes: 1.1e9, blocked: 0, connected: true },
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
  await expect(faq.locator("details")).toHaveCount(12);
  const answer = faq.getByText("服務沒有你的 email，也只保存號碼的雜湊值");
  await expect(answer).toBeHidden();
  await faq.getByText("帳號號碼弄丟了怎麼辦？").click();
  await expect(answer).toBeVisible();
  await faq.getByRole("link", { name: "所有常見問題" }).click();
  await expect(page).toHaveURL(/\/faq\/$/);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["申請與帳號", "安裝與連線", "額度與規則", "隱私"]);
  await expect(page.locator("details")).toHaveCount(28);
  // opened straight from a link elsewhere, the page loads fresh with the question open
  await page.goto("/dns/");
  await page.goto("/faq/#q-noTraffic");
  await expect(page.locator("#q-noTraffic")).toHaveAttribute("open", "");
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

test("signed-in pages keep their shape while loading and reuse what they saw", async ({ page }) => {
  let meCalls = 0;
  let devicesCalls = 0;
  let releaseDevices = () => {};
  const devicesHeld = new Promise<void>((r) => (releaseDevices = r));
  const never = new Promise<void>(() => {});
  await mockApi(page, {
    // the first answers come back (/api/me twice: the session check and the page); later ones never do, so
    // whatever shows must come from memory
    "GET /api/me": async (route) => {
      if (meCalls++ > 1) await never;
      await route.fulfill({ json: ME });
    },
    "GET /api/devices": async (route) => {
      await (devicesCalls++ > 0 ? never : devicesHeld);
      await route.fulfill({ json: DEVICES });
    },
    "GET /api/regions": json([{ id: "sg", open: true }]),
  });
  await page.goto("/devices/");
  const main = page.locator("main");
  await expect(main.locator(".sk").first()).toBeVisible();
  await expect(main.locator("section")).toHaveAttribute("aria-busy", "true");
  await expect(main.getByRole("status")).toHaveText("載入中");
  releaseDevices();
  await expect(page.getByTestId("device-list").getByText("phone")).toBeVisible();
  await expect(main.locator(".sk")).toHaveCount(0);

  await page.locator(".subnav").getByRole("link", { name: "帳號" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("帳號");
  await expect(page.locator(".facts dd").first()).not.toBeEmpty();
  await page.locator(".subnav").getByRole("link", { name: "我的裝置" }).click();
  await expect(page.getByTestId("device-list").getByText("laptop")).toBeVisible();
  await expect(main.locator(".sk")).toHaveCount(0);
});

test("terms show grey lines until their text arrives", async ({ page }) => {
  await page.goto("/");
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/assets\/terms\.zh-TW-.*\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  await page.locator("footer").getByRole("link", { name: "使用條款" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("使用條款");
  await expect(page.locator("main .sk").first()).toBeVisible();
  release();
  await expect(page.locator("main h2").first()).toBeVisible();
  await expect(page.locator("main .sk")).toHaveCount(0);
});

test("password managers can save and fill the account number", async ({ page }) => {
  // stands in for Chromium's PasswordCredential, which headless browsers do not prompt for
  await page.addInitScript(() => {
    const stored: unknown[] = [];
    (window as unknown as { stored: unknown[] }).stored = stored;
    (window as unknown as { PasswordCredential: unknown }).PasswordCredential = class {
      constructor(public data: { id: string; password: string }) {}
    };
    Object.defineProperty(navigator, "credentials", {
      value: { store: async (c: { data: unknown }) => void stored.push(c.data) },
    });
  });
  await mockApi(page, { "POST /api/redeem": json({ account_number: "4821 0937 5564 2018" }), ...signedIn });
  await page.goto("/redeem/");
  await page.getByLabel("邀請碼").fill("abcd-efgh-jkmn-pqrs");
  await page.getByRole("button", { name: "兌換" }).click();
  await page.getByLabel("我已經把號碼存在安全的地方").check();
  await page.getByRole("button", { name: "繼續" }).click();
  await expect(page).toHaveURL(/\/devices\/$/);
  expect(await page.evaluate(() => (window as unknown as { stored: unknown[] }).stored))
    .toEqual([{ id: "Vessel", password: "4821 0937 5564 2018", name: "Vessel" }]);

  // the sign-in form is a user name and a password, the shape password managers look for;
  // a page without the mocks is signed out, so the form stays
  const login = await page.context().newPage();
  await mockApi(login, { "GET /api/me": json({ error: "signed_out" }, 401) });
  await login.goto("/login/");
  await expect(login.locator('input[autocomplete="username"]')).toHaveValue("Vessel");
  const number = login.getByLabel("帳號號碼");
  await expect(number).toHaveAttribute("type", "password");
  await expect(number).toHaveAttribute("autocomplete", "current-password");
  await number.fill("4821093755642018");
  await login.getByRole("button", { name: "顯示" }).click();
  await expect(number).toHaveAttribute("type", "text");
  await expect(number).toHaveValue("4821 0937 5564 2018");
  await login.getByRole("button", { name: "隱藏" }).click();
  await expect(number).toHaveAttribute("type", "password");
});

test("each device shows its traffic this month and, with a filter, the blocked malware lookups", async ({ page }) => {
  await mockApi(page, signedIn);
  await page.goto("/devices/");
  const usage = page.getByTestId("device-usage");
  await expect(usage).toHaveText(["本月 3.1 GB · 擋下 12 次惡意網域查詢", "本月 1.1 GB"]);
});

test("the devices page refreshes on its own", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-28T04:00:00Z") });
  let status = "pending";
  let fail = false;
  let devicesCalls = 0;
  await mockApi(page, {
    "GET /api/me": json({ ...ME, usage_as_of: "2026-10-28T03:57:00+00:00" }),
    "GET /api/devices": (route) => {
      devicesCalls++;
      return fail ? route.fulfill({ status: 500, json: { error: "unknown" } }) : route.fulfill({ json: [{ ...DEVICES[0], status }] });
    },
  });
  await page.goto("/devices/");
  const badge = page.getByTestId("device-list").locator(".badge");
  await expect(badge).toHaveText("建立中");
  await expect(page.getByTestId("usage-as-of")).toContainText("用量更新於");

  // a pending device is checked every 10 seconds until the node has added it
  status = "active";
  await page.clock.fastForward(10_000);
  await expect(badge).toHaveText("使用中");
  // Preact runs effect cleanups (here, stopping the 10-second check) on a timer after paint, and the fake
  // clock owns that timer too: let it run, and let a check already on its way land, before counting
  await page.clock.runFor(1000);
  await page.waitForLoadState("networkidle");
  const settled = devicesCalls;
  await page.clock.fastForward(60_000);
  expect(devicesCalls).toBe(settled);

  // every 5 minutes after that; a failed background refresh keeps what is on screen
  fail = true;
  await page.clock.fastForward(5 * 60_000);
  await expect.poll(() => devicesCalls).toBeGreaterThan(settled);
  await expect(badge).toHaveText("使用中");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a device that never connected says so and links to help", async ({ page }) => {
  const fresh = { ...DEVICES[0], id: "d-ccc", name: "tablet", used_bytes: 0, blocked: 0, connected: false };
  await mockApi(page, { ...signedIn, "GET /api/devices": json([DEVICES[0], fresh]) });
  await page.goto("/devices/");
  const list = page.getByTestId("device-list");
  await expect(list.getByTestId("not-connected")).toHaveCount(1);
  const note = list.locator("li", { hasText: "tablet" }).getByTestId("not-connected");
  await expect(note).toContainText("還沒連上過");
  await note.getByRole("link", { name: "連不上怎麼辦？" }).click();
  await expect(page).toHaveURL(/\/faq\/#q-trouble$/);
  await expect(page.locator("#q-trouble")).toHaveAttribute("open", "");
});

test("devices made before their region moved host ask for a new config", async ({ page }) => {
  const soon = { ...DEVICES[0], id: "d-ccc", name: "tablet", region: "jp", moved_until: "2999-01-01" };
  const gone = { ...DEVICES[0], id: "d-ddd", name: "watch", region: "jp", moved_until: "2000-01-01" };
  await mockApi(page, { ...signedIn, "GET /api/devices": json([DEVICES[0], soon, gone]) });
  await page.goto("/devices/");
  const list = page.getByTestId("device-list");
  await expect(list.getByTestId("moved")).toHaveCount(2);
  // three devices is the limit here, so the old one has to go first
  await expect(list.locator("li", { hasText: "tablet" }).getByTestId("moved"))
    .toHaveText("東京節點換了新的主機，這台裝置的設定檔 2999/01/01 之後就不能連線。請先刪除這一台，再新增一台裝置、匯入新的設定檔。");
  await expect(list.locator("li", { hasText: "watch" }).getByTestId("moved")).toContainText("設定檔已經不能連線");

  await mockApi(page, { ...signedIn, "GET /api/devices": json([soon]) });
  await page.goto("/en/devices/");
  await expect(page.getByTestId("moved"))
    .toHaveText(/^The Tokyo node has moved to a new server, and this device's config stops working after .+\. Add a new device, import the new config, then delete this one\.$/);
});

// /api/me answers after a pause, so the test can look at what the page shows before it knows the session
const slow = (body: unknown, status = 200): Handler => async (route) => {
  await new Promise((r) => setTimeout(r, 1500));
  await route.fulfill({ status, json: body });
};
const hinted = (page: Page) => page.addInitScript(() => localStorage.setItem("vessel-signed-in", "1"));

test("a browser that was signed in shows its links at once", async ({ page }) => {
  await hinted(page);
  await mockApi(page, { ...signedIn, "GET /api/me": slow(ME) });
  await page.goto("/");
  const header = page.locator(".site-header");
  await expect(header.getByRole("link", { name: "我的裝置" })).toBeVisible({ timeout: 500 });
  await expect(header.getByRole("link", { name: "登入" })).toHaveCount(0);
  await expect(page.locator(".hero").getByRole("link", { name: "我的裝置" })).toBeVisible();
});

test("an unknown session shows no sign-in link until /api/me answers", async ({ page }) => {
  await mockApi(page, { "GET /api/me": slow({ error: "signed_out" }, 401) });
  await page.goto("/");
  const login = page.locator(".site-header").getByRole("link", { name: "登入" });
  await expect(login).toBeHidden();
  await expect(page.locator(".hero").getByRole("link", { name: "我有邀請碼" })).toBeHidden();
  await expect(login).toBeVisible();
  await expect(page.locator(".hero").getByRole("link", { name: "我有邀請碼" })).toBeVisible();
});

test("a hint from an expired session is corrected and dropped", async ({ page }) => {
  await hinted(page);
  await mockApi(page, { "GET /api/me": slow({ error: "signed_out" }, 401) });
  await page.goto("/login/");
  // the sign-in page waits for the confirmed answer before sending anyone to their devices
  await expect(page).toHaveURL(/\/login\/$/);
  await expect(page.locator(".site-header").getByRole("link", { name: "我的裝置" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("vessel-signed-in"))).toBeNull();
  await expect(page).toHaveURL(/\/login\/$/);
});

test("waiting for the server shows what is happening", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  let deleted = false;
  await mockApi(page, {
    ...signedIn,
    "GET /api/devices": (route) => route.fulfill({ json: deleted ? [DEVICES[1]] : DEVICES }),
    "DELETE /api/devices/d-aaa": async (route) => {
      await held;
      deleted = true;
      await route.fulfill({ json: { ok: true } });
    },
  });
  page.on("dialog", (d) => d.accept());
  await page.goto("/devices/");
  const phone = page.getByTestId("device-list").locator("li", { hasText: "phone" });
  await phone.getByRole("button", { name: "刪除" }).click();
  await expect(phone.getByRole("status")).toHaveText("刪除中");
  await expect(phone).toHaveAttribute("aria-busy", "true");
  release();
  await expect(page.getByTestId("device-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("device-list")).not.toContainText("刪除中");
});

test("signing in shows that it is working", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await mockApi(page, {
    "GET /api/me": json({ error: "signed_out" }, 401),
    "POST /api/login": async (route) => {
      await held;
      await route.fulfill({ status: 401, json: { error: "bad_number" } });
    },
  });
  await page.goto("/login/");
  await page.getByLabel("帳號號碼").fill("4821 0937 5564 2018");
  await page.getByRole("button", { name: "登入", exact: true }).last().click();
  const busy = page.locator("form").getByRole("button", { name: "登入中" });
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute("aria-busy", "true");
  release();
  await expect(page.locator("form").getByRole("button", { name: "登入", exact: true })).toBeEnabled();
});
