import { expect, test } from "@playwright/test";

test("beside the questions on wide screens, with translated layer names", async ({ page, isMobile }) => {
  test.skip(isMobile, "wide screens only");
  await page.goto("/");
  const art = page.locator(".faq-art");
  await expect(art).toBeVisible();
  await expect(art).toHaveAttribute("aria-hidden", "true");
  await expect(art.locator(".faq-art__label")).toHaveText(["你的裝置", "網路業者", "Vessel 節點", "網站"]);
  await expect(art.locator(".faq-art__legend li")).toHaveText(["目的地", "你的 IP", "節點的 IP", "你的帳號"]);
  // the layer names sit at different heights, placed by class rather than a style attribute
  const tops = await art.locator(".faq-art__label").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect(new Set(tops).size).toBe(4);
  await art.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      art.locator("canvas").evaluate((c: HTMLCanvasElement) => {
        const { data } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
        return false;
      }),
    )
    .toBe(true);
  await page.goto("/en/");
  await expect(page.locator(".faq-art__label").first()).toHaveText("Your device");
});

test("not shown or loaded on phones", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout");
  const loaded: string[] = [];
  page.on("request", (r) => { if (/faq-art-/.test(r.url())) loaded.push(r.url()); });
  await page.goto("/");
  await expect(page.locator(".faq-art")).toBeHidden();
  await page.locator("#faq").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  expect(loaded).toEqual([]);
});

test("the prerendered home page has no style attributes for the CSP to block", async ({ request }) => {
  const html = await (await request.get("/")).text();
  expect(html).not.toMatch(/\sstyle="/);
});
