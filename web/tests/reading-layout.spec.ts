import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
});

test("VPN basics: on a wide screen the contents sit beside the text and the links jump to each section", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/learn/");
  const toc = page.getByTestId("learn-toc");
  const links = toc.getByRole("link");
  const headings = page.locator(".learn-body > h2");
  await expect(links).toHaveCount(await headings.count());
  const box = (await toc.boundingBox())!;
  const body = (await page.locator(".learn-body").boundingBox())!;
  expect(body.x).toBeGreaterThan(box.x + box.width);
  // a comfortable line length, however wide the screen
  expect(body.width).toBeLessThanOrEqual(720);
  await links.last().click();
  await expect(headings.last()).toBeInViewport();
});

test("the connection check: the tool beside what to do next on a wide screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/check/");
  const tool = (await page.getByTestId("connection-check").boundingBox())!;
  const next = (await page.getByTestId("check-next").boundingBox())!;
  expect(Math.abs(tool.y - next.y)).toBeLessThan(2);
  expect(next.x).toBeGreaterThan(tool.x + tool.width);
});

test("the FAQ: the cross-section beside the questions on a wide screen, questions keep their width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/faq/");
  const art = page.locator(".faq-page .faq-art");
  await expect(art).toBeVisible();
  const question = (await page.locator(".faq-page .faq").first().boundingBox())!;
  const box = (await art.boundingBox())!;
  expect(box.x).toBeGreaterThan(question.x + question.width);
  expect(question.width).toBeLessThanOrEqual(760);
  expect(box.width).toBeGreaterThan(200);
  // a link to one question still opens it
  await page.goto("/");
  await page.goto("/faq/#q-risky");
  await expect(page.locator("details#q-risky")).toHaveAttribute("open");
});

for (const path of ["/learn/", "/check/", "/faq/"]) {
  test(`${path}: one column on a phone, nothing wider than the screen`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("learn-toc")).toBeHidden();
    await expect(page.locator(".faq-page .faq-art")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("tapping twice does not zoom the page, and pinching still can", async ({ page }) => {
  await page.goto("/faq/");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction)).toBe("manipulation");
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).not.toContain("user-scalable");
  expect(viewport).not.toContain("maximum-scale");
});

test("plain text responds to clicks, without which iOS ignores touch-action, and only links keep the tap highlight", async ({ page }) => {
  await page.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (this: EventTarget, ...args: Parameters<typeof add>) {
      if (args[0] === "click" && this instanceof Element && this.id === "app") document.documentElement.dataset.appClick = "1";
      return add.apply(this, args);
    };
  });
  await page.goto("/faq/");
  await expect(page.locator("html")).toHaveAttribute("data-app-click", "1");
  const highlight = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).webkitTapHighlightColor);
  expect(await highlight("#app")).toBe("rgba(0, 0, 0, 0)");
  expect(await highlight("a.brand")).not.toBe("rgba(0, 0, 0, 0)");
});
