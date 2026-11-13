import { execSync } from "node:child_process";
import { type Page, type Route, expect, test } from "@playwright/test";
import { FEEDBACK_ENDPOINT } from "../src/feedback.ts";
import { SENT } from "../src/group-apply.ts";
import zhTW from "../src/i18n/zh-TW.json" with { type: "json" };

/** Catch what the page sends to the form server; `status` is what the server answers. */
async function formServer(page: Page, status = 200) {
  const sent: { surveyId: string; finished: boolean; data: Record<string, string> }[] = [];
  await page.route(FEEDBACK_ENDPOINT, async (route: Route) => {
    const req = route.request();
    expect(req.method()).toBe("POST");
    // no cookies and no Referer reach the form server
    expect(req.headers()["referer"]).toBeUndefined();
    sent.push(req.postDataJSON());
    await route.fulfill({ status, json: status === 200 ? { data: { id: "r1" } } : { code: "forbidden" } });
  });
  // nothing about a request may reach the portal
  const portal: string[] = [];
  await page.route((url) => url.hostname === "127.0.0.1" && url.pathname.startsWith("/api/"), (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path !== "/api/me") portal.push(path);
    return route.fulfill({ status: 401, json: { error: "signed_out" } });
  });
  return { sent, portal };
}

// the commit the pages under test are built from, sent with every reply (see src/rev.ts)
const REV = execSync("git rev-parse HEAD").toString().trim().slice(0, 7);

test("the zh-TW labels on the page are the texts the survey stores", () => {
  const ui = zhTW as Record<string, string>;
  for (const [field, options] of Object.entries(SENT["zh-TW"])) {
    for (const [id, text] of Object.entries(options)) expect(ui[`groupApply.${field}.${id}`]).toBe(text);
  }
});

test("ask for group accounts from the group page: three choices and a contact, the rest optional", async ({ page }) => {
  const { sent, portal } = await formServer(page);
  await page.goto("/for-groups/");
  await page.getByRole("link", { name: "填寫申請表單" }).click();
  await expect(page).toHaveURL(/\/for-groups\/apply\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("申請團體帳號");

  // nothing chosen: each of the three says so, and nothing is sent
  await page.getByRole("button", { name: "送出申請" }).click();
  await expect(page.getByText("請選擇一項。")).toHaveCount(3);
  await expect(page.getByText("請留下聯絡方式，我們才能回覆。")).toBeVisible();
  expect(sent).toHaveLength(0);

  await page.getByLabel("媒體").check();
  await page.getByLabel("10 到 30 人").check();
  await page.getByLabel("幾個月").check();
  await page.getByRole("button", { name: "需要", exact: true }).click();
  await page.getByLabel("團體的名稱").fill("  測試編輯室  ");
  await page.getByLabel("想補充的事").fill("十二月有一趟採訪");
  await page.getByLabel("聯絡方式").fill(" @desk:example.org ");
  await page.getByRole("button", { name: "送出申請" }).click();

  await expect(page.getByTestId("group-apply-sent")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("收到申請了");
  expect(sent).toEqual([{
    surveyId: "cmwf4myps000o01o3jpqwbuvj",
    finished: true,
    data: {
      kind: "媒體", size: "10 到 30 人", period: "幾個月", inspect: "需要", group: "測試編輯室", message: "十二月有一趟採訪",
      contact: "@desk:example.org", locale: "zh-TW", rev: REV,
    },
  }]);
  expect(portal).toEqual([]);
  await page.getByRole("link", { name: "回到團體帳號的介紹" }).click();
  await expect(page).toHaveURL(/\/for-groups\/$/);
});

test("the English page sends to the English survey, the simplified Chinese one to the zh-TW survey", async ({ page }) => {
  const { sent } = await formServer(page);
  await page.goto("/en/for-groups/apply/");
  await page.getByLabel("Campaign team").check();
  await page.getByLabel("Fewer than 10").check();
  await page.getByLabel("Long term").check();
  await page.getByLabel("Contact").fill("desk@example.org");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByTestId("group-apply-sent")).toBeVisible();

  await page.goto("/zh-cn/for-groups/apply/");
  await page.getByLabel("公民团体").check();
  await page.getByLabel("100 人以上").check();
  await page.getByLabel("单次活动，几天到几周").check();
  await page.getByLabel("联系方式").fill("desk@example.org");
  await page.getByRole("button", { name: "提交申请" }).click();
  await expect(page.getByTestId("group-apply-sent")).toBeVisible();

  expect(sent.map((s) => [s.surveyId, s.data])).toEqual([
    ["cmwf4mz79000p01o3dxvvofxh", { kind: "Campaign team", size: "Fewer than 10", period: "Long term", contact: "desk@example.org", locale: "en", rev: REV }],
    ["cmwf4myps000o01o3jpqwbuvj", { kind: "公民團體", size: "100 人以上", period: "單次活動，幾天到幾週", contact: "desk@example.org", locale: "zh-CN", rev: REV }],
  ]);
});

test("a closed survey says so and points to email; the page is kept out of search", async ({ page, request }) => {
  const { sent } = await formServer(page, 403);
  await page.goto("/for-groups/apply/");
  await page.getByRole("radio", { name: "其他" }).check();
  await page.getByLabel("10 人以下").check();
  await page.getByLabel("長期").check();
  await page.getByLabel("聯絡方式").fill("desk@example.org");
  await page.getByRole("button", { name: "送出申請" }).click();
  await expect(page.getByRole("alert")).toHaveText("團體帳號的申請暫時沒有開放，請稍後再試，或寄信到 whisper@anoni.net。");
  expect(sent).toHaveLength(1);
  expect(await (await request.get("/for-groups/apply/")).text()).toContain('<meta name="robots" content="noindex">');
  expect(await (await request.get("/sitemap.xml")).text()).not.toContain("/for-groups/apply/");
});
