import { expect, test } from "@playwright/test";
import { ONION_SITE } from "../src/site.ts";

// The onion address in the footer, and the pages with scripts turned off (Tor Browser at its Safest level,
// anoni-net/vessel#147): they say JavaScript is needed, and the forms never put a number in the address.

test("the footer links the same page on the onion site", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
  await page.goto("/en/faq/");
  const line = page.getByTestId("footer-onion");
  await expect(line).toContainText("On Tor, the onion site: vessel.anoninet");
  await expect(line.getByRole("link")).toHaveAttribute("href", `${ONION_SITE}/en/faq/`);
  // the long address breaks instead of widening a phone's page
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/faq/#q-tor");
  await expect(page.locator("#q-tor")).toContainText("「最安全」時會停用 JavaScript");
});

test.describe("without scripts", () => {
  test.use({ javaScriptEnabled: false });

  test("a page says it needs JavaScript, and signing in does not send the number in the address", async ({ page }) => {
    await page.goto("/login/");
    await expect(page.locator(".noscript")).toContainText("需要 JavaScript");
    await page.locator("#number").fill("1234 5678 9012 3456");
    const sent = page.waitForRequest((req) => req.url().startsWith("http://127.0.0.1:4174/login/") && req.method() === "POST");
    await page.getByRole("button", { name: "登入" }).click();
    expect(new URL((await sent).url()).search).toBe("");
  });

  test("redeeming does not send the code in the address", async ({ page }) => {
    await page.goto("/en/redeem/");
    await expect(page.locator(".noscript")).toContainText("needs JavaScript");
    await expect(page.locator("form")).toHaveAttribute("method", "post");
  });
});
