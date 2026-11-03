import { expect, test } from "@playwright/test";

// The home page's pictures: the connection in the hero, the blocklists and the disguise under 使用情境. Chinese names
// with short English ones under them, English alone on the English pages.

test("the connection picture names each part and says what it shows", async ({ page }) => {
  await page.goto("/");
  const fig = page.locator(".hero .hero-fig");
  await expect(fig.getByRole("img")).toHaveAttribute("aria-label", /東京或新加坡的 Vessel 節點/);
  await expect(fig.locator(".hero-fig__label")).toHaveText(["你的裝置YOUR DEVICE", "東京節點NODE · TYO", "新加坡節點NODE · SIN", "網際網路INTERNET", "加密連線ENCRYPTED"]);
  await expect(fig.locator("figcaption")).toHaveText("FIG. 01連線經過 Vessel 的節點");
  await page.goto("/en/");
  await expect(page.locator(".hero-fig__en")).toHaveCount(0);
  await expect(page.locator(".hero .hero-fig__label").first()).toHaveText("Your device");
});

test("under 使用情境, the blocklists and the disguise, each with a few words and a link", async ({ page }) => {
  await page.goto("/");
  const works = page.locator("#works");
  await expect(works.getByRole("heading", { level: 2 })).toHaveText("Vessel 的做法");
  await expect(works.locator("figcaption")).toHaveText(["FIG. 02組合多份公開名單，擋下詐騙與釣魚網站", "FIG. 03以 AmneziaWG 偽裝連線，不容易被認出是 VPN"]);
  await expect(works.getByRole("img").nth(1)).toHaveAttribute("aria-label", /開源的 AmneziaWG/);
  await expect(works.locator(".hero-fig__label--on")).toHaveText(["詐騙網站SCAM", "釣魚網站PHISHING", "惡意程式MALWARE"]);
  await expect(works.getByRole("link", { name: "偽裝有多可靠？" })).toHaveAttribute("href", "/faq/#q-disguise");
  // the order on the page: 使用情境, then this, then 使用方式
  const ids = await page.locator("main > section[id]").evaluateAll((s) => s.map((e) => e.id));
  expect(ids.slice(0, 3)).toEqual(["when", "works", "how"]);
});

test("with prefers-reduced-motion the lines hold still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (const line of await page.locator(".hero-fig__path--live").all()) expect(await line.evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
});

test("on phones the hero's picture sits under the buttons, on wide screens beside the words", async ({ page, isMobile }) => {
  await page.goto("/");
  const words = await page.locator(".hero__text").boundingBox();
  const figs = await page.locator(".hero .hero-fig").boundingBox();
  if (isMobile) expect(figs!.y).toBeGreaterThan(words!.y + words!.height);
  else expect(figs!.x).toBeGreaterThan(words!.x + words!.width);
});
