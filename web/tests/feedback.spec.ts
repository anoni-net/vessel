import { type Page, type Route, expect, test } from "@playwright/test";
import { FEEDBACK_ENDPOINT, SENT } from "../src/feedback.ts";
import zhTW from "../src/i18n/zh-TW.json" with { type: "json" };

/** Catch what the page sends to the form server; `status` is what the server answers. */
async function formServer(page: Page, status = 200) {
  const sent: unknown[] = [];
  await page.route(FEEDBACK_ENDPOINT, async (route: Route) => {
    const req = route.request();
    expect(req.method()).toBe("POST");
    // no cookies and no Referer reach the form server
    expect(req.headers()["referer"]).toBeUndefined();
    sent.push(req.postDataJSON());
    await route.fulfill({ status, json: status === 200 ? { data: { id: "r1" } } : { code: "forbidden" } });
  });
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
  return sent;
}

test("the zh-TW labels on the page are the texts the survey stores", () => {
  const ui = zhTW as Record<string, string>;
  for (const [field, options] of Object.entries(SENT["zh-TW"])) {
    for (const [id, text] of Object.entries(options)) expect(ui[`feedback.${field}.${id}`]).toBe(text);
  }
});

test("send feedback with the optional answers and where it came from", async ({ page }) => {
  const sent = await formServer(page);
  await page.goto("/feedback/?from=devices");
  await page.getByRole("button", { name: "送出" }).click();
  await expect(page.getByText("請選一個類型。")).toBeVisible();
  await page.getByLabel("連不上或常斷線").check();
  await page.getByLabel("發生了什麼事？").fill("太短");
  await page.getByRole("button", { name: "送出" }).click();
  await expect(page.getByText("請至少寫 10 個字。")).toBeVisible();
  expect(sent).toHaveLength(0);

  await page.getByLabel("發生了什麼事？").fill("匯入之後顯示已連線，但網頁都打不開");
  await page.getByRole("button", { name: "行動網路" }).click();
  await page.getByRole("button", { name: "Android" }).click();
  await page.getByRole("button", { name: "東京" }).click();
  await page.getByRole("button", { name: "東京" }).click(); // pressing it again clears it
  await page.getByLabel("聯絡方式").fill("me@example.org");
  await page.getByRole("button", { name: "送出" }).click();
  await expect(page.getByTestId("feedback-sent")).toContainText("收到了，謝謝");
  expect(sent).toEqual([{
    surveyId: "cmvrpvj5f001001o1wzcld0xe",
    finished: true,
    data: {
      kind: "連不上或常斷線",
      message: "匯入之後顯示已連線，但網頁都打不開",
      locale: "zh-TW",
      network: "行動網路",
      platform: "Android",
      contact: "me@example.org",
      from: "devices",
    },
  }]);
});

test("the simplified Chinese page sends traditional option texts to the zh-TW survey", async ({ page }) => {
  const sent = await formServer(page);
  await page.goto("/zh-cn/feedback/?from=elsewhere");
  await page.getByLabel("速度太慢").check();
  await page.getByLabel("发生了什么事？").fill("晚上速度只有平常的一半左右");
  await page.getByRole("button", { name: "提交" }).click();
  await expect(page.getByTestId("feedback-sent")).toBeVisible();
  // an unknown "from" is dropped
  expect(sent).toEqual([{ surveyId: "cmvrpvj5f001001o1wzcld0xe", finished: true, data: { kind: "速度太慢", message: "晚上速度只有平常的一半左右", locale: "zh-CN" } }]);
});

test("English goes to the English survey; a closed survey says so", async ({ page }) => {
  const sent = await formServer(page, 403);
  await page.goto("/en/feedback/");
  await page.getByLabel("A suggestion or a feature I want").check();
  await page.getByLabel("What happened?").fill("A city in Europe would help");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toHaveText("Feedback is closed for now. Please try again later.");
  expect((sent[0] as { surveyId: string }).surveyId).toBe("cmvrpvjmc001101o17lirnihu");
});

test("the footer, the device list and the FAQ link to it", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
  await page.goto("/faq/");
  await expect(page.getByRole("link", { name: "沒有找到答案？告訴我們" })).toHaveAttribute("href", "/feedback/?from=faq");
  await expect(page.locator("footer").getByRole("link", { name: "回饋" })).toHaveAttribute("href", "/feedback/?from=footer");
  await page.locator("footer").getByRole("link", { name: "回饋" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("回饋");
});
