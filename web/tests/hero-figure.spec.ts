import { expect, test } from "@playwright/test";

// The home page's pictures: the connection in the hero, the blocklists and the disguise under 使用情境. Chinese names
// with short English ones under them, English alone on the English pages.

test("the connection picture names each part and says what it shows", async ({ page }) => {
  await page.goto("/");
  const fig = page.locator(".hero .hero-fig");
  await expect(fig.getByRole("img")).toHaveAttribute("aria-label", /東京、台北或新加坡的 Vessel 節點/);
  await expect(fig.locator(".hero-fig__label")).toHaveText(["你的裝置YOUR DEVICE", "東京節點NODE · TYO", "台北節點NODE · TPE", "新加坡節點NODE · SIN", "網際網路INTERNET", "加密連線ENCRYPTED"]);
  await expect(fig.locator("figcaption")).toHaveText("FIG. 01連線經過 Vessel 的節點");
  await page.goto("/en/");
  await expect(page.locator(".hero-fig__en")).toHaveText(["NODE", "NODE", "NODE"]);
  await expect(page.locator(".hero .hero-fig__label").first()).toHaveText("Your device");
  // the cities alone, "node" under them, so "Singapore" stays clear of the globe
  await expect(page.locator(".hero .hero-fig__label").nth(3)).toHaveText("SingaporeNODE");
  const sg = await page.locator(".hero .hero-fig__label").nth(3).boundingBox();
  const globe = await page.locator(".hero circle.hero-fig__top").boundingBox();
  expect(sg!.x + sg!.width).toBeLessThanOrEqual(globe!.x);
});

test("under 使用情境, the blocklists, the disguise, the relay routes and the keys, each with a few words", async ({ page }) => {
  await page.goto("/");
  const works = page.locator("#works");
  await expect(works.getByRole("heading", { level: 2 })).toHaveText("Vessel 的做法");
  await expect(works.locator("figcaption")).toHaveText([
    "FIG. 02組合多份公開名單，擋下詐騙與釣魚網站", "FIG. 03以 AmneziaWG 偽裝連線，不容易被認出是 VPN",
    "FIG. 04從台北入口連線，出口是你選的城市", "FIG. 05金鑰在你的裝置上產生，私鑰不會離開",
  ]);
  await expect(works.getByRole("img").nth(2)).toHaveAttribute("aria-label", /入口只轉送加密的封包、不解開通道，再轉到你選的城市的節點/);
  await expect(works.getByRole("img").nth(3)).toHaveAttribute("aria-label", /只有公鑰送到入口網站與節點/);
  await expect(works.getByRole("link", { name: "隱私權政策" })).toHaveAttribute("href", "/privacy/");
  await expect(works.getByRole("img").nth(1)).toHaveAttribute("aria-label", /開源的 AmneziaWG/);
  await expect(works.locator(".hero-fig__label--on")).toHaveText(["詐騙網站SCAM", "釣魚網站PHISHING", "惡意程式MALWARE"]);
  await expect(works.getByRole("link", { name: "偽裝有多可靠？" })).toHaveAttribute("href", "/faq/#q-disguise");
  // the order on the page: 使用情境, then this, then 使用方式
  const ids = await page.locator("main > section[id]").evaluateAll((s) => s.map((e) => e.id));
  expect(ids.slice(0, 3)).toEqual(["when", "works", "how"]);
});

test("the lines move once the drawing is in view: FIG. 03's two beams sweep to and fro, twice, and stop", async ({ page }) => {
  await page.goto("/");
  const beams = page.locator("#works .hero-fig__sweep");
  await expect(beams).toHaveCount(2);
  // still until it is seen (pages/in-view.ts)
  for (const beam of await beams.all()) expect(await beam.evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
  await beams.first().scrollIntoViewIfNeeded();
  await expect(page.locator("#works .hero-fig").nth(1)).toHaveClass(/hero-fig--live/);
  for (const beam of await beams.all()) {
    expect(await beam.evaluate((e) => getComputedStyle(e).animationName)).toBe("hero-fig-sweep");
    expect(await beam.evaluate((e) => getComputedStyle(e).animationIterationCount)).toBe("2");
  }
});

test("with prefers-reduced-motion the lines hold still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (const line of await page.locator(".hero-fig__path--live, .hero-fig__sweep").all()) {
    expect(await line.evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
  }
});

test("on phones the hero's picture sits under the buttons, on wide screens beside the words", async ({ page, isMobile }) => {
  await page.goto("/");
  const words = await page.locator(".hero__text").boundingBox();
  const figs = await page.locator(".hero .hero-fig").boundingBox();
  if (isMobile) expect(figs!.y).toBeGreaterThan(words!.y + words!.height);
  else expect(figs!.x).toBeGreaterThan(words!.x + words!.width);
});

test("the title is the word for screen readers, blocks to the eye, filled once the pixel person delivers its packet", async ({ page }) => {
  await page.goto("/");
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toHaveText("Vessel");
  await expect(title.locator("svg")).toHaveAttribute("aria-hidden", "true");
  const person = page.locator(".pixel-person");
  expect(await person.evaluate((e) => getComputedStyle(e).animationName)).toBe("pixel-person-path");
  // a tap makes it jump
  await title.locator("svg").click();
  await expect(page.locator(".pixel-person__jump")).toHaveClass(/pixel-person__jump--on/);
  // with prefers-reduced-motion it simply stands there
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await person.evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
  expect(await person.evaluate((e) => getComputedStyle(e).transform)).toBe("matrix(1, 0, 0, 1, 305, 1.5)");
  // and the word is already filled with cobalt, the packet already in the l
  expect(await page.locator(".block-title__front").first().evaluate((e) => getComputedStyle(e).fill)).toBe("rgb(11, 60, 168)");
  expect(await page.locator(".pixel-person__packet").evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
});

test("the four pictures under 使用情境 are framed alike, two to a row on a wide screen", async ({ page, isMobile }) => {
  await page.goto("/");
  const drawings = page.locator("#works .hero-fig svg");
  await expect(drawings).toHaveCount(4);
  const boxes = await Promise.all([0, 1, 2, 3].map(async (i) => (await drawings.nth(i).boundingBox())!));
  // the same frame for every drawing, at any width
  for (const b of boxes) expect(Math.abs(b.height - boxes[0].height)).toBeLessThanOrEqual(1);
  if (isMobile) return;
  // two to a row: the frames and the captions in a row line up
  const figs = page.locator("#works .hero-fig");
  for (const [i, j] of [[0, 1], [2, 3]]) {
    const [fa, fb] = [(await figs.nth(i).boundingBox())!, (await figs.nth(j).boundingBox())!];
    expect(Math.abs(fa.y - fb.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(fa.height - fb.height)).toBeLessThanOrEqual(1);
  }
});
