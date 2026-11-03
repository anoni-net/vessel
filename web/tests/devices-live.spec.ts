import { type Locator, type Page, expect, test } from "@playwright/test";

// The devices page between two reads of the nodes: the page asks shortly after the next read is due, the numbers
// move to the new read with a "+…" on each card, and each device gets a dot for whether it was in use.

const ME = { created_on: "2026-10-27", last_login_on: "2026-10-27", device_limit: 3, monthly_quota_bytes: 50e9 };
const device = (id: string, name: string, used: number, blocked: number) => ({
  id, name, region: "sg", dns_filter: "malware", status: "active", created_on: "2026-10-27", expires_on: "2026-11-26",
  used_bytes: used, blocked, connected: true,
});
const READS = [
  { as_of: "2026-10-28T03:58:00+00:00", devices: [device("d-aaa", "phone", 3.1e9, 12), device("d-bbb", "laptop", 1.1e9, 4)] },
  { as_of: "2026-10-28T04:03:00+00:00", devices: [device("d-aaa", "phone", 3.3e9, 15), device("d-bbb", "laptop", 1.1e9, 4)] },
];

async function mockReads(page: Page) {
  let read = 0;
  const calls: number[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const r = READS[read];
    const used = r.devices.reduce((n, d) => n + d.used_bytes, 0);
    if (path === "/api/me") return route.fulfill({ json: { ...ME, used_bytes: used, usage_as_of: r.as_of } });
    if (path === "/api/devices") {
      calls.push(Date.now());
      return route.fulfill({ json: r.devices });
    }
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  return { next: () => { read = Math.min(read + 1, READS.length - 1); }, calls };
}

test("the page asks again once the next read has landed and shows what it added", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-28T04:00:00Z") });
  const api = await mockReads(page);
  await page.goto("/devices/");
  const usage = page.getByTestId("device-usage");
  await expect(usage.first()).toHaveText("本月 3.1 GB · 擋下 12 次惡意網站的查詢");
  // one read seen: no dot yet, since the page cannot tell what changed
  await expect(page.locator(".live-dot")).toHaveCount(0);
  await expect(page.locator(".next-read")).toHaveAttribute("title", /下次更新約/);
  await page.waitForLoadState("networkidle");
  const first = api.calls.length;

  // the read at 04:03 is due on the page at 04:03:20; nothing is asked before that
  api.next();
  await page.clock.fastForward("03:00");
  expect(api.calls.length).toBe(first);
  await page.clock.fastForward("00:30");
  await expect.poll(() => api.calls.length).toBe(first + 1);

  await page.clock.runFor(2000);
  await expect(usage.first()).toHaveText("本月 3.3 GB · 擋下 15 次惡意網站的查詢");
  // what the read added sits on the card's top edge, so nothing in the card moves
  const added = (card: Locator) => card.locator(".added__item");
  await expect(added(page.locator(".card--tint"))).toHaveText(["+200 MB", "擋下 +3"]);
  const phone = page.getByTestId("device-list").locator("li", { hasText: "phone" });
  const laptop = page.getByTestId("device-list").locator("li", { hasText: "laptop" });
  await expect(added(phone)).toHaveText(["+200 MB", "擋下 +3"]);
  await expect(added(laptop)).toHaveCount(0);
  await expect(phone.locator(".live-dot--on")).toHaveAttribute("title", "最近 5 分鐘有流量");
  await expect(laptop.locator(".live-dot")).toHaveAttribute("title", "最近 5 分鐘沒有流量");
  await expect(laptop.locator(".live-dot--on")).toHaveCount(0);

  // the chips stay clear of the card above, its 4px shadow included
  const chip = await added(phone).first().boundingBox();
  const above = await page.locator(".card--tint").boundingBox();
  expect(chip!.y).toBeGreaterThanOrEqual(above!.y + above!.height + 4);
});

test("a late read is asked for again after a minute, not five", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-28T04:04:00Z") });
  const api = await mockReads(page);
  await page.goto("/devices/");
  await expect(page.getByTestId("device-usage").first()).toContainText("3.1 GB");
  await page.waitForLoadState("networkidle");
  const first = api.calls.length;
  // the read at 03:58 should have been followed by one at 04:03; it has not, so the page checks again in a minute
  await page.clock.fastForward("01:05");
  await expect.poll(() => api.calls.length).toBe(first + 1);
});
