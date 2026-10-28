import { expect, test } from "@playwright/test";

// Search engines and link previews read the HTML as sent, before any script runs.
test.skip(({ isMobile }) => isMobile, "the HTML is the same on every screen");

test("each page has its own head in its own language", async ({ request }) => {
  const html = await (await request.get("/en/faq/")).text();
  expect(html).toContain('<html lang="en">');
  expect(html).toContain("<title>Frequently asked questions · Vessel</title>");
  expect(html).toContain('<meta name="description" content="Common questions about Vessel');
  expect(html).toContain('<link rel="canonical" href="https://vessel.anoni.net/en/faq/">');
  for (const [lang, url] of [["zh-Hant-TW", "/faq/"], ["zh-Hans-CN", "/zh-cn/faq/"], ["en", "/en/faq/"], ["x-default", "/faq/"]]) {
    expect(html).toContain(`<link rel="alternate" hreflang="${lang}" href="https://vessel.anoni.net${url}">`);
  }
  expect(html).toContain('<meta property="og:image" content="https://assets.anoni.net/vessel/og-en-');
  expect(html).not.toContain('name="robots"');

  const home = await (await request.get("/zh-cn/")).text();
  expect(home).toContain('<html lang="zh-Hans-CN">');
  expect(home).toContain("<title>Vessel</title>");
  expect(home).toContain('<meta property="og:locale" content="zh_CN">');
});

test("pages that need a session are kept out of search", async ({ request }) => {
  for (const path of ["/devices/", "/devices/new/", "/account/", "/en/account/"]) {
    const html = await (await request.get(path)).text();
    expect(html, path).toContain('<meta name="robots" content="noindex">');
    expect(html, path).not.toContain('<link rel="alternate" hreflang');
  }
});

test("robots.txt and sitemap.xml", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /api/");
  expect(robots).toContain("Sitemap: https://vessel.anoni.net/sitemap.xml");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap.match(/<loc>/g)).toHaveLength(24); // eight public pages in three languages
  expect(sitemap).toContain("<loc>https://vessel.anoni.net/en/privacy/</loc>");
  expect(sitemap).not.toContain("/devices/");
});

test("the content is there without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/faq/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("常見問題");
  await expect(page.getByText("VPN、WireGuard 與 AmneziaWG 有什麼關係？")).toBeVisible();
  await page.goto("/en/privacy/");
  await expect(page.getByRole("heading", { level: 2, name: "Backups" })).toBeVisible();
  await context.close();
});

test("the app takes over the prerendered page without doubling it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/en/privacy/");
  await expect(page.getByRole("heading", { level: 2, name: "Backups" })).toBeVisible();
  await expect(page.locator("header")).toHaveCount(1);
  await expect(page.locator("main")).toHaveCount(1);
  // the app is running: moving to another page happens without a reload
  await page.locator("footer").getByRole("link", { name: "Frequently asked questions" }).click();
  await expect(page).toHaveURL(/\/en\/faq\/$/);
  await expect(page).toHaveTitle("Frequently asked questions · Vessel");
  expect(errors).toEqual([]);
});
