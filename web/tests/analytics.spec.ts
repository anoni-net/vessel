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

async function open(init?: () => void): Promise<[Page, Record<string, unknown>[]]> {
  const page = await browser.newPage();
  if (init) await page.addInitScript(init);
  const sent: Record<string, unknown>[] = [];
  await page.route("https://aa.anoni.net/**", async (route) => {
    sent.push(route.request().postDataJSON().payload);
    await route.fulfill({ status: 200, json: {} });
  });
  await page.route(ORIGIN + "/api/**", (route) =>
    route.fulfill(new URL(route.request().url()).pathname === "/api/me" ? { json: ME } : { json: [] }));
  return [page, sent];
}

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

test("pages after sign-in and unknown pages send nothing", async () => {
  const [page, sent] = await open();
  for (const path of ["/devices/", "/account/", "/devices/new/", "/en/account/", "/nope/"]) {
    await page.goto(ORIGIN + path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
  }
  expect(sent).toEqual([]);
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
