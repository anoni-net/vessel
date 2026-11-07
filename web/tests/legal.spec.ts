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
