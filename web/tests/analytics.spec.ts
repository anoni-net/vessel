import { type Browser, type Page, chromium, expect, test } from "@playwright/test";

// Analytics only send from vessel.anoni.net, so these tests point that name at the preview server.
const ORIGIN = "http://vessel.anoni.net:4174";
const ME = { created_on: "2026-10-27", last_login_on: "2026-10-27", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 0 };

let browser: Browser;
test.beforeAll(async () => {
  browser = await chromium.launch({ args: ["--host-resolver-rules=MAP vessel.anoni.net 127.0.0.1"] });
});
test.afterAll(() => browser.close());
test.skip(({ isMobile }) => isMobile, "one browser is enough");

const NODE = {
  interface: { Address: "10.8.1.7/32", DNS: "10.8.1.1", MTU: "1280", I1: "<r 2>" },
  peer: { PublicKey: "srvkey", AllowedIPs: "0.0.0.0/0, ::/0", Endpoint: "198.51.100.1:443" },
};

type Api = (method: string, path: string) => { status?: number; json: unknown } | undefined;

const signedIn: Api = (method, path) =>
  path === "/api/me" ? { json: ME } : path === "/api/regions" ? { json: [{ id: "sg", open: true }] } : { json: [] };

async function open(init?: () => void, api: Api = signedIn, userAgent?: string): Promise<[Page, Record<string, unknown>[]]> {
  const page = await browser.newPage({ userAgent });
  if (init) await page.addInitScript(init);
  const sent: Record<string, unknown>[] = [];
  await page.route("https://aa.anoni.net/**", async (route) => {
    sent.push(route.request().postDataJSON().payload);
    await route.fulfill({ status: 200, json: {} });
  });
  await page.route(ORIGIN + "/api/**", (route) => {
    const req = route.request();
    const res = api(req.method(), new URL(req.url()).pathname) ?? signedIn(req.method(), new URL(req.url()).pathname)!;
    return route.fulfill({ status: res.status ?? 200, json: res.json });
  });
  return [page, sent];
}

const events = (sent: Record<string, unknown>[]) => sent.filter((s) => s.name).map((s) => [s.name, s.data ?? null]);

test("public pages send the path and nothing else", async () => {
  const [page, sent] = await open();
  await page.goto(ORIGIN + "/en/faq/");
  await expect.poll(() => sent.length).toBe(1);
  expect(Object.keys(sent[0]).sort()).toEqual(["hostname", "language", "referrer", "screen", "url", "website"]);
  expect(sent[0]).toMatchObject({ hostname: "vessel.anoni.net", url: "/en/faq/", referrer: "" });
  expect(sent[0].screen).toMatch(/^\d+00x\d+00$/);
  await page.getByRole("link", { name: "Terms of use" }).click();
  await expect.poll(() => sent.map((s) => s.url)).toEqual(["/en/faq/", "/en/terms/"]);
  await page.close();
});

test("pages after sign-in and unknown pages send no page views", async () => {
  const [page, sent] = await open();
  for (const path of ["/devices/", "/account/", "/devices/new/", "/en/account/", "/nope/"]) {
    await page.goto(ORIGIN + path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
  }
  expect(sent.filter((s) => !s.name)).toEqual([]);
  await page.close();
});

test("the footer switch turns it off and on", async () => {
  const [page, sent] = await open();
  await page.goto(ORIGIN + "/");
  await expect.poll(() => sent.length).toBe(1);
  await page.getByRole("button", { name: "不要記錄" }).click();
  await expect(page.getByText("這個瀏覽器已經停止記錄。")).toBeVisible();
  await page.goto(ORIGIN + "/faq/");
  await page.waitForLoadState("networkidle");
  expect(sent.length).toBe(1);
  await page.getByRole("button", { name: "恢復記錄" }).click();
  await page.getByRole("link", { name: "使用條款" }).click();
  await expect.poll(() => sent.map((s) => s.url)).toEqual(["/", "/terms/"]);
  await page.close();
});

test("Global Privacy Control means nothing is sent", async () => {
  const [page, sent] = await open(() => Object.defineProperty(navigator, "globalPrivacyControl", { value: true }));
  await page.goto(ORIGIN + "/");
  await expect(page.getByText("你的瀏覽器要求不追蹤，所以不記錄。")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(sent).toEqual([]);
  await page.close();
});

test("redeeming and creating a device send each step and its result", async () => {
  let redeems = 0;
  const [page, sent] = await open(undefined, (method, path) => {
    if (path === "/api/redeem") return ++redeems === 1 ? { status: 400, json: { error: "invalid_invite" } } : { json: { account_number: "4821 0937 5564 2018" } };
    if (path === "/api/devices" && method === "POST") return { json: { id: "d-abcdef123456", status: "active", config: NODE } };
  }, "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36");
  await page.goto(ORIGIN + "/redeem/");
  await page.getByLabel("邀請碼").fill("abcd-efgh-jkmn-pqrs");
  await page.getByRole("button", { name: "兌換" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "兌換" }).click();
  await page.getByLabel("我已經把號碼存在安全的地方").check();
  await page.getByRole("button", { name: "繼續" }).click();
  await page.getByRole("link", { name: "新增裝置" }).first().click();
  await page.getByRole("button", { name: "已經安裝，下一步" }).click();
  await page.getByRole("button", { name: /新加坡/ }).click();
  await page.getByLabel("裝置名稱").fill("我的手機");
  await page.getByRole("button", { name: "產生設定檔" }).click();
  await page.getByRole("button", { name: "下載設定檔" }).click();
  await page.getByRole("link", { name: "我已經匯入，完成" }).click();

  const platform = "android";
  await expect.poll(() => events(sent)).toEqual([
    ["redeem", { result: "invalid_invite" }],
    ["redeem", { result: "ok" }],
    ["number-continue", null],
    ["device-step", { step: "install", platform }],
    ["device-step", { step: "region", platform }],
    ["device-step", { step: "name", platform }],
    ["device-create", { result: "ok", platform }],
    ["device-step", { step: "config", platform }],
    ["device-config", { how: "download" }],
    ["device-config", { how: "done" }],
  ]);
  // page views stay on the public pages, and nothing names the account, the device or the region
  expect(sent.filter((s) => !s.name).map((s) => s.url)).toEqual(["/redeem/"]);
  const all = JSON.stringify(sent);
  for (const secret of ["4821", "我的手機", "\"sg\"", "abcd", "srvkey"]) expect(all).not.toContain(secret);
  await page.close();
});

test("errors the pages do not know are sent as other", async () => {
  const [page, sent] = await open(undefined, (method, path) =>
    path === "/api/login" ? { status: 500, json: { error: "database is on fire" } } : undefined);
  await page.goto(ORIGIN + "/login/");
  await page.getByLabel("帳號號碼").fill("1234 5678 9012 3456");
  await page.getByRole("button", { name: "登入" }).last().click();
  await expect.poll(() => events(sent)).toEqual([["login", { result: "other" }]]);
  expect(JSON.stringify(sent)).not.toContain("1234");
  await page.close();
});
