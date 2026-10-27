import { type Page, expect, test } from "@playwright/test";

// what the canvas shows right now, so two moments can be compared
const snapshot = (page: Page) =>
  page.locator(".hero__art canvas").evaluate((c: HTMLCanvasElement) => c.toDataURL());

const drawn = (page: Page) =>
  page.locator(".hero__art canvas").evaluate((c: HTMLCanvasElement) => {
    const { data } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
    return false;
  });

test("the packet picture draws and moves, and is decoration only", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".hero__art")).toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => drawn(page)).toBe(true);
  const before = await snapshot(page);
  await expect.poll(() => snapshot(page)).not.toBe(before);
});

test("it holds still for prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect.poll(() => drawn(page)).toBe(true);
  const first = await snapshot(page);
  await page.waitForTimeout(600);
  expect(await snapshot(page)).toBe(first);
});

test("on phones it sits under the buttons", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout");
  await page.goto("/");
  const buttons = await page.locator(".hero .actions").boundingBox();
  const art = await page.locator(".hero__art").boundingBox();
  expect(art!.y).toBeGreaterThan(buttons!.y + buttons!.height);
  expect(art!.height).toBe(200);
});
