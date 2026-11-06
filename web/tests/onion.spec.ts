import { type Page, expect, test } from "@playwright/test";
import { FEEDBACK_ENDPOINT_ONION } from "../src/feedback.ts";
import { CSP_ONION } from "../vite.config.ts";

// The onion build (VESSEL_TARGET=onion, anoni-net/vessel#147), served by its own preview on 4175 (the "onion"
// project in playwright.config.ts). It loads nothing from clearnet, offers no passkeys, and explains the checks
// that cannot work over Tor.

const ME = { created_on: "2026-10-27", last_login_on: "2026-11-05", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 23e9 };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3"/></svg>';

/** The backend and the onion site's own images, and every request the page makes to another host. */
async function onion(page: Page, signedIn = false) {
  const elsewhere: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.host !== "127.0.0.1:4175" && req.url() !== FEEDBACK_ENDPOINT_ONION) elsewhere.push(req.url());
  });
  // nginx serves these from the images directory; the preview server does not have them
  await page.route("**/vessel-assets/*.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: SVG }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!signedIn) return route.fulfill({ status: 401, json: { error: "signed_out" } });
    if (path === "/api/me") return route.fulfill({ json: ME });
    if (path === "/api/passkeys") return route.fulfill({ json: [{ id: 1, label: "iPhone", created_on: "2026-10-27" }] });
    if (path === "/api/usage/months") return route.fulfill({ json: { filter: "malware", months: [] } });
    if (path === "/api/invites") {
      return route.fulfill({ json: { per_account: 1, used: 0, left: 0, reason: "too_new", eligible_on: "2026-11-10", days: 7, open: [] } });
    }
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  return elsewhere;
}

test("the onion site sends its own policy and loads only from itself", async ({ page }) => {
  const elsewhere = await onion(page);
  const res = await page.goto("/");
  expect(res!.headers()["content-security-policy"]).toBe(CSP_ONION);
  expect(CSP_ONION).not.toContain("https://");
  await expect(page.locator("header img").first()).toHaveAttribute("src", /^\/vessel-assets\//);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /^\/vessel-assets\//);
  // no share image on clearnet, and the community links stay on Tor
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(0);
  await expect(page.locator('footer a[href^="http://anoninet"]').first()).toBeVisible();
  // the footer leads back to the same page on clearnet
  await expect(page.getByTestId("footer-onion").getByRole("link")).toHaveAttribute("href", "https://vessel.anoni.net/");
  await page.goto("/faq/");
  await page.goto("/en/");
  expect(elsewhere).toEqual([]);
});

test("no passkey to sign in with on the onion site", async ({ page }) => {
  await onion(page);
  await page.goto("/login/");
  await expect(page.getByLabel("帳號號碼")).toBeVisible();
  await expect(page.getByTestId("passkey-login")).toHaveCount(0);
});

test("the account page says passkeys are for vessel.anoni.net, and still lists them", async ({ page }) => {
  await onion(page, true);
  await page.goto("/account/");
  const passkeys = page.getByTestId("passkeys");
  await expect(passkeys.getByText("iPhone")).toBeVisible();
  await expect(passkeys).toContainText("passkey 綁定 vessel.anoni.net");
  await expect(passkeys.getByRole("button", { name: "加上 passkey" })).toHaveCount(0);
  await expect(page.getByTestId("rotate")).toHaveCount(0);
});

test("the connection check points to vessel.anoni.net", async ({ page }) => {
  const elsewhere = await onion(page);
  await page.goto("/check/");
  const card = page.getByTestId("connection-check");
  await expect(card).toContainText("onion 版經過 Tor 網路連線");
  await expect(card.getByRole("link")).toHaveAttribute("href", "https://vessel.anoni.net/check/");
  await page.goto("/en/dns/");
  const dns = page.getByTestId("dns-check");
  await expect(dns).toContainText("reached over Tor");
  await expect(dns.getByRole("link")).toHaveAttribute("href", "https://vessel.anoni.net/en/dns/");
  // the domain lookup asks the portal's own API, so it stays
  await expect(page.getByTestId("dns-lookup")).toBeVisible();
  expect(elsewhere).toEqual([]);
});

test("feedback goes to the form server's onion address", async ({ page }) => {
  await onion(page);
  const sent: unknown[] = [];
  await page.route(FEEDBACK_ENDPOINT_ONION, async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { data: { id: "r1" } } });
  });
  await page.goto("/feedback/");
  await page.getByLabel("建議或想要的功能").check();
  await page.getByLabel("發生了什麼事？").fill("希望 onion 版也能看到節點的狀態");
  await page.getByRole("button", { name: "送出" }).click();
  await expect(page.getByTestId("feedback-sent")).toBeVisible();
  expect(sent).toHaveLength(1);
});
