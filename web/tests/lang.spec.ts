import { type Page, expect, test } from "@playwright/test";

const signedOut = (page: Page) =>
  page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));

for (const [locale, page, offered] of [
  ["zh-HK", "/en/", "這個頁面也有正體中文版。"],
  ["zh-CN", "/", "这个页面也有简体中文版。"],
  ["en-GB", "/zh-cn/", "This page is also available in English."],
  ["ja-JP", "/", null],
  ["zh", "/en/", null],
] as const) {
  test.describe(`a browser in ${locale}`, () => {
    test.use({ locale });
    test(`on ${page}`, async ({ page: p }) => {
      await signedOut(p);
      await p.goto(page);
      await expect(p.locator("main h1")).toBeVisible();
      if (offered) await expect(p.getByTestId("lang-hint")).toContainText(offered);
      else await expect(p.getByTestId("lang-hint")).toHaveCount(0);
    });
  });
}

test.describe("a browser that prefers English", () => {
  test.use({ locale: "en-US" });

  test("is offered English, and the choice sticks to the bare address", async ({ page }) => {
    await signedOut(page);
    await page.goto("/faq/");
    const hint = page.getByTestId("lang-hint");
    await expect(hint).toContainText("This page is also available in English.");
    await expect(hint).toHaveAttribute("lang", "en");
    await hint.getByRole("link", { name: "Switch to English" }).click();
    await expect(page).toHaveURL(/\/en\/faq\/$/);
    await expect(page.getByTestId("lang-hint")).toHaveCount(0);
    // never redirected by itself: a zh-TW link still opens in zh-TW, without the bar
    await page.goto("/dns/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("網域過濾");
    await expect(page.getByTestId("lang-hint")).toHaveCount(0);
    // the bare address goes to the picked language
    await page.goto("/");
    await expect(page).toHaveURL(/\/en\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vessel");
  });

  test("closing the bar keeps it closed", async ({ page }) => {
    await signedOut(page);
    await page.goto("/");
    await page.getByTestId("lang-hint").getByRole("button", { name: "No thanks" }).click();
    await expect(page.getByTestId("lang-hint")).toHaveCount(0);
    await page.reload();
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.getByTestId("lang-hint")).toHaveCount(0);
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  });

  test("an English page offers nothing", async ({ page }) => {
    await signedOut(page);
    await page.goto("/en/");
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.getByTestId("lang-hint")).toHaveCount(0);
  });
});

test("a language picked in the footer is remembered for the bare address", async ({ page }) => {
  await signedOut(page);
  await page.goto("/");
  await expect(page.getByTestId("lang-hint")).toHaveCount(0);
  await page.locator("footer").getByRole("link", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/\/zh-cn\/$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/zh-cn\/$/);
  // picking Traditional Chinese again keeps / where it is
  await page.locator("footer").getByRole("link", { name: "正體中文" }).click();
  await page.goto("/");
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vessel");
});
