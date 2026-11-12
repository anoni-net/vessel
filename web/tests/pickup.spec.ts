import { type Page, type Route, expect, test } from "@playwright/test";

// Asking for an invite with a pickup number (pages/pickup.tsx, toomore/anoni-net-ws#441).

const INFO = {
  open: true,
  purposes: ["travel", "school_work", "public_wifi", "privacy", "other"],
  networks: ["home", "mobile", "school_work", "public", "other"],
  note_max: 200,
};
const NUMBER = "ABCD-EFGH-JKMN-PQRS";

async function pickup(page: Page, handlers: Record<string, (route: Route) => unknown> = {}) {
  const asked: unknown[] = [];
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const key = `${req.method()} ${new URL(req.url()).pathname}`;
    if (handlers[key]) return handlers[key](route);
    if (key === "GET /api/me") return route.fulfill({ status: 401, json: { error: "signed_out" } });
    if (key === "GET /api/pickup") return route.fulfill({ json: INFO });
    if (key === "POST /api/pickup") {
      expect(req.headers()["x-vessel-request"]).toBe("1");
      asked.push(req.postDataJSON());
      return route.fulfill({ json: { number: NUMBER } });
    }
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  return asked;
}

const status = (state: string, until: string | null = null) => (route: Route) => route.fulfill({ json: { state, until } });

test("asking: two choices and a note, then the number shown once", async ({ page }) => {
  const asked = await pickup(page, { "POST /api/pickup/status": status("waiting") });
  await page.goto("/pickup/");
  await expect(page.getByRole("heading", { level: 1, name: "申請邀請碼" })).toBeVisible();
  // checking a number saved earlier is folded under the form
  await expect(page.getByLabel("取件號碼")).toBeHidden();
  await page.getByText("已經有取件號碼了？").click();
  await expect(page.getByLabel("取件號碼")).toBeVisible();
  // both choices are needed
  await page.getByRole("button", { name: "送出申請" }).click();
  await expect(page.getByRole("alert")).toHaveCount(2);
  await page.getByRole("radio", { name: "出國的時候" }).check();
  await page.getByRole("radio", { name: "公共 Wi-Fi", exact: true }).check();
  await page.getByLabel("想補充的話").fill("  出差住旅館  ");
  await page.getByRole("button", { name: "送出申請" }).click();
  expect(asked).toEqual([{ purpose: "travel", network: "public", note: "出差住旅館" }]);

  await expect(page.getByTestId("pickup-number")).toHaveText(NUMBER);
  await expect(page.getByRole("button", { name: "勾選上面的確認後繼續" })).toBeDisabled();
  await page.getByLabel("我已經存好這組號碼").check();
  await page.getByRole("button", { name: "繼續", exact: true }).click();
  await expect(page.getByTestId("pickup-waiting")).toContainText("還在排隊");
  // this browser remembers it
  expect(await page.evaluate(() => localStorage.getItem("vessel-pickup"))).toBe(NUMBER);
});

test("approved: redeem it, the number after the # so it stays off the server", async ({ page }) => {
  await page.addInitScript((n) => localStorage.setItem("vessel-pickup", n), NUMBER);
  await pickup(page, { "POST /api/pickup/status": status("approved", "2026-11-26") });
  await page.goto("/pickup/");
  await expect(page.getByTestId("pickup-approved")).toContainText("2026/11/26 之前");
  await page.getByRole("link", { name: "建立帳號" }).click();
  await expect(page).toHaveURL(/\/redeem\/$/);
  await expect(page.getByLabel("邀請碼")).toHaveValue(NUMBER);
});

test("declined, unknown and used say so; used forgets the number", async ({ page }) => {
  await page.addInitScript((n) => localStorage.setItem("vessel-pickup", n), NUMBER);
  let answer = "declined";
  await pickup(page, { "POST /api/pickup/status": (route) => status(answer)(route) });
  await page.goto("/pickup/");
  await expect(page.getByTestId("pickup-declined")).toHaveText("這次的申請沒有通過。");
  answer = "unknown";
  await page.getByRole("button", { name: "重新查詢" }).click();
  await expect(page.getByTestId("pickup-unknown")).toContainText("找不到這組號碼");
  answer = "used";
  await page.getByRole("button", { name: "重新查詢" }).click();
  await expect(page.getByTestId("pickup-used")).toContainText("已經建立過帳號");
  await expect(page.getByTestId("pickup-status").getByRole("link", { name: "登入" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("vessel-pickup"))).toBeNull();
});

test("closed: no form, and a saved number can still be checked", async ({ page }) => {
  let checked = "";
  await pickup(page, {
    "GET /api/pickup": (route) => route.fulfill({ json: { ...INFO, open: false } }),
    "POST /api/pickup/status": (route) => {
      checked = route.request().postDataJSON().number;
      return status("waiting")(route);
    },
  });
  await page.goto("/pickup/");
  await expect(page.getByTestId("pickup-closed")).toBeVisible();
  await expect(page.getByTestId("pickup-form")).toHaveCount(0);
  await page.getByLabel("取件號碼").fill("abcdefghjkmnpqrs");
  await page.getByRole("button", { name: "查詢", exact: true }).click();
  await expect(page.getByTestId("pickup-waiting")).toBeVisible();
  expect(checked).toBe(NUMBER);
  // forgotten: back to the start
  await page.getByRole("button", { name: "從這個瀏覽器移除號碼" }).click();
  await expect(page.getByTestId("pickup-closed")).toBeVisible();
});

test("a request turned away says why", async ({ page }) => {
  await pickup(page, { "POST /api/pickup": (route) => route.fulfill({ status: 429, json: { error: "pickup_busy" } }) });
  await page.goto("/pickup/");
  await page.getByRole("radio", { name: "其他" }).first().check();
  await page.getByRole("radio", { name: "行動網路" }).check();
  await page.getByRole("button", { name: "送出申請" }).click();
  await expect(page.getByRole("alert")).toHaveText("目前申請的人比較多，請過幾天再試。");
});

test("a pickup number still waiting, typed on /redeem/, says it is waiting", async ({ page }) => {
  await pickup(page, { "POST /api/redeem": (route) => route.fulfill({ status: 400, json: { error: "pickup_waiting" } }) });
  await page.goto("/redeem/");
  await page.getByLabel("邀請碼").fill(NUMBER);
  await page.getByRole("button", { name: "兌換" }).click();
  await expect(page.getByRole("alert")).toHaveText("這組號碼還在等待審核，核准之後才能建立帳號。");
});

test("noindex, and left out of the sitemap", async ({ page, request }) => {
  await pickup(page);
  await page.goto("/pickup/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  expect(await (await request.get("/sitemap.xml")).text()).not.toContain("/pickup/");
});
