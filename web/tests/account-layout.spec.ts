import { type Page, expect, test } from "@playwright/test";

// The account page on a wide screen: the monthly record and the invites in one column, the passkeys in the other,
// deleting the account across the bottom; on a phone the sections stack as before.

const ME = { created_on: "2026-10-27", last_login_on: "2026-11-05", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 23e9 };

async function backend(page: Page) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: ME });
    if (path === "/api/passkeys") return route.fulfill({ json: [{ id: 1, label: "iPhone", created_on: "2026-10-27" }] });
    if (path === "/api/usage/months") {
      return route.fulfill({ json: { filter: "malware", months: [{ month: "2026-11-01", used_bytes: 23e9, blocked: 12, blocked_ads: 0 }] } });
    }
    if (path === "/api/invites") {
      return route.fulfill({ json: { per_account: 1, used: 0, left: 1, reason: null, eligible_on: "2026-11-10", days: 7, open: [] } });
    }
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}

const box = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!;

test("on a wide screen the record and the passkeys sit side by side, deleting the account under both", async ({ page, isMobile }) => {
  test.skip(isMobile, "the phone keeps one column");
  await backend(page);
  await page.goto("/account/");
  await expect(page.getByTestId("passkeys").getByText("iPhone")).toBeVisible();
  const [months, invites, passkeys] = [await box(page, "months"), await box(page, "invites"), await box(page, "passkeys")];
  expect(Math.round(passkeys.y)).toBe(Math.round(months.y));
  expect(passkeys.x).toBeGreaterThan(months.x + months.width);
  expect(invites.y).toBeGreaterThan(months.y + months.height - 1);
  const del = (await page.getByRole("heading", { name: "刪除帳號" }).boundingBox())!;
  expect(del.y).toBeGreaterThan(Math.max(invites.y + invites.height, passkeys.y + passkeys.height) - 1);
});

test("on a phone the account's sections stack", async ({ page, isMobile }) => {
  test.skip(!isMobile, "only the phone");
  await backend(page);
  await page.goto("/account/");
  await expect(page.getByTestId("passkeys").getByText("iPhone")).toBeVisible();
  const [months, invites, passkeys] = [await box(page, "months"), await box(page, "invites"), await box(page, "passkeys")];
  expect(invites.y).toBeGreaterThan(months.y);
  expect(passkeys.y).toBeGreaterThan(invites.y);
  expect(Math.round(passkeys.x)).toBe(Math.round(months.x));
});
