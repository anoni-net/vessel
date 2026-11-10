import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
});

for (const path of ["/privacy/", "/terms/"]) {
  test(`${path}: on a wide screen the contents sit beside the text and the links jump to each section`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    const toc = page.getByTestId("legal-toc");
    await expect(toc).toBeVisible();
    const links = toc.getByRole("link");
    const headings = page.locator(".legal-body > h2");
    await expect(links).toHaveCount(await headings.count());
    await expect(links.first()).toHaveText((await headings.first().textContent())!);
    const tocBox = (await toc.boundingBox())!;
    const body = (await page.locator(".legal-body").boundingBox())!;
    expect(body.x).toBeGreaterThan(tocBox.x + tocBox.width);
    expect(body.width).toBeGreaterThan(700);
    await links.last().click();
    await expect(headings.last()).toBeInViewport();
    expect(new URL(page.url()).pathname).toBe(path);
  });

  test(`${path}: one column with no contents on a phone, nothing wider than the screen`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(path);
    await expect(page.locator(".legal-body > h2").first()).toBeVisible();
    await expect(page.getByTestId("legal-toc")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("WCAG 1.3.1: on a phone a policy's table stays a table with its column names", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/privacy/");
  await expect(page.getByRole("table").first()).toBeAttached();
  expect(await page.getByRole("columnheader").count()).toBeGreaterThan(0);
  await expect(page.getByRole("cell").first()).toBeAttached();
});

test("the terms link to what a group's leaders see, and the policy says it", async ({ page }) => {
  await page.goto("/terms/");
  await page.getByRole("link", { name: "隱私權政策的「團體」" }).click();
  await expect(page).toHaveURL(/\/privacy\/#groups$/);
  await expect(page.locator("#groups")).toHaveText("團體");
  await expect(page.locator("#groups")).toBeInViewport();
  await expect(page.getByText("負責人可以請成員檢測團體裡的某台裝置")).toContainText("負責人看不到網站名稱、次數、出現的時段、流量與你的報告");
});

test("the consent page can link to the device inspection section of the policy", async ({ page }) => {
  await page.goto("/privacy/#inspection");
  await expect(page.locator("#inspection")).toHaveText("裝置檢測");
  await expect(page.locator("#inspection")).toBeInViewport();
});
