import { expect, test } from "@playwright/test";

// The hero's three pictures: Chinese names with short English ones under them (English alone on the English pages),
// one picture at a time, the next every few seconds unless chosen or held.

test("the connection picture names each part and says what it shows", async ({ page }) => {
  await page.goto("/");
  const fig = page.locator(".hero-figs__slide--on .hero-fig");
  await expect(fig.getByRole("img")).toHaveAttribute("aria-label", /東京或新加坡的 Vessel 節點/);
  await expect(fig.locator(".hero-fig__label")).toHaveText(["你的裝置YOUR DEVICE", "東京節點NODE · TYO", "新加坡節點NODE · SIN", "網際網路INTERNET", "加密連線ENCRYPTED"]);
  await expect(fig.locator("figcaption")).toHaveText("FIG. 01連線經過 Vessel 的節點");
  await page.goto("/en/");
  await expect(page.locator(".hero-fig__en")).toHaveCount(0);
  await expect(page.locator(".hero-figs__slide--on .hero-fig__label").first()).toHaveText("Your device");
});

test("the pictures turn every few seconds, and stop once one is chosen", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  const on = page.locator(".hero-figs__slide--on figcaption");
  await expect(on).toContainText("FIG. 01");
  await page.clock.fastForward(7100);
  await expect(on).toContainText("FIG. 02");
  await expect(on).toContainText("組合多份公開名單");
  // the hidden pictures are out of reach for keyboards and screen readers
  await expect(page.locator(".hero-figs__slide:not(.hero-figs__slide--on)")).toHaveCount(2);
  for (const s of await page.locator(".hero-figs__slide:not(.hero-figs__slide--on)").all()) {
    await expect(s).toHaveAttribute("aria-hidden", "true");
    await expect(s).toHaveAttribute("inert", "");
  }
  await page.getByRole("button", { name: /顯示第 3 張/ }).click();
  await expect(on).toContainText("以 AmneziaWG 偽裝連線");
  await expect(page.getByRole("button", { name: /顯示第 3 張/ })).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(0, 0);
  await page.clock.fastForward(20_000);
  await expect(on).toContainText("FIG. 03");
});

test("with prefers-reduced-motion they turn only when chosen, and the line holds still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto("/");
  await page.clock.fastForward(20_000);
  await expect(page.locator(".hero-figs__slide--on figcaption")).toContainText("FIG. 01");
  for (const line of await page.locator(".hero-fig__path--live").all()) expect(await line.evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
});

test("on phones they sit under the buttons, on wide screens beside the words", async ({ page, isMobile }) => {
  await page.goto("/");
  const words = await page.locator(".hero__text").boundingBox();
  const figs = await page.locator(".hero-figs").boundingBox();
  if (isMobile) expect(figs!.y).toBeGreaterThan(words!.y + words!.height);
  else expect(figs!.x).toBeGreaterThan(words!.x + words!.width);
});
