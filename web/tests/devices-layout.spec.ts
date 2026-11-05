import { type Page, expect, test } from "@playwright/test";

// The devices page on a wide screen: the devices side by side, a free slot as a dashed card in the grid with the add
// button; on a phone one column and the button under the list, as before.

const ME = { created_on: "2026-10-27", last_login_on: "2026-11-05", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 23e9 };
const device = (id: string, name: string) => ({
  id, name, region: "sg", dns_filter: "malware", status: "active", created_on: "2026-11-01", expires_on: "2026-12-04",
  used_bytes: 1e9, blocked: 3, connected: true, ipv6: true, moved_until: null,
});

async function backend(page: Page, n: number) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: ME });
    if (path === "/api/devices") return route.fulfill({ json: [device("d-a", "phone"), device("d-b", "laptop"), device("d-c", "tablet")].slice(0, n) });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}

const tops = async (page: Page) =>
  Promise.all((await page.getByTestId("device").all()).map(async (li) => (await li.boundingBox())!.y));

test("on a wide screen the three devices are one row", async ({ page, isMobile }) => {
  test.skip(isMobile, "the phone keeps one column");
  await backend(page, 3);
  await page.goto("/devices/");
  const ys = await tops(page);
  expect(ys).toHaveLength(3);
  expect(new Set(ys.map(Math.round)).size).toBe(1);
  await expect(page.getByTestId("add-blocked")).toBeVisible();
});

test("on a wide screen a free slot is a card in the row, and it is the only add button", async ({ page, isMobile }) => {
  test.skip(isMobile, "the phone keeps the button under the list");
  await backend(page, 2);
  await page.goto("/devices/");
  const slot = page.getByTestId("device-list").getByRole("link", { name: "新增裝置" });
  await expect(slot).toBeVisible();
  await expect(page.getByRole("link", { name: "新增裝置" })).toHaveCount(1);
  await expect(page.getByText("還可以新增 1 台")).toBeVisible();
  const ys = await tops(page);
  expect(new Set(ys.map(Math.round)).size).toBe(1);
});

test("on a phone the devices stack and the add button stays under the list", async ({ page, isMobile }) => {
  test.skip(!isMobile, "only the phone");
  await backend(page, 2);
  await page.goto("/devices/");
  const ys = await tops(page);
  expect(ys[1]).toBeGreaterThan(ys[0]);
  await expect(page.getByTestId("device-list").getByRole("link", { name: "新增裝置" })).toBeHidden();
  await expect(page.getByRole("link", { name: "新增裝置" })).toHaveCount(1);
  const list = (await page.getByTestId("device-list").boundingBox())!;
  const button = (await page.getByRole("link", { name: "新增裝置" }).boundingBox())!;
  expect(button.y).toBeGreaterThan(list.y + list.height - 1);
});
