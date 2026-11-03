import { expect, test } from "@playwright/test";

// The connection picture in the hero: Chinese names with short English ones under them, English alone on the
// English pages, and a still line for prefers-reduced-motion.

test("the connection picture names each part and says what it shows", async ({ page }) => {
  await page.goto("/");
  const fig = page.locator(".hero-fig");
  await expect(fig.getByRole("img")).toHaveAttribute("aria-label", /東京或新加坡的 Vessel 節點/);
  await expect(fig.locator(".hero-fig__label")).toHaveText(["你的裝置YOUR DEVICE", "東京節點NODE · TYO", "新加坡節點NODE · SIN", "網際網路INTERNET", "加密連線ENCRYPTED"]);
  await expect(fig.locator("figcaption")).toHaveText("FIG. 01連線經過 Vessel 的節點");
  await page.goto("/en/");
  await expect(page.locator(".hero-fig__en")).toHaveCount(0);
  await expect(page.locator(".hero-fig__label").first()).toHaveText("Your device");
});

test("the line to the node moves, except for prefers-reduced-motion", async ({ page }) => {
  await page.goto("/");
  const live = page.locator(".hero-fig__path--live");
  expect(await live.evaluate((e) => getComputedStyle(e).animationName)).toBe("hero-fig-flow");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await live.evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
});

test("on phones it sits under the buttons, on wide screens beside the words", async ({ page, isMobile }) => {
  await page.goto("/");
  const words = await page.locator(".hero__text").boundingBox();
  const fig = await page.locator(".hero-fig").boundingBox();
  if (isMobile) expect(fig!.y).toBeGreaterThan(words!.y + words!.height);
  else expect(fig!.x).toBeGreaterThan(words!.x + words!.width);
});
