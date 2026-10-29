import { type Page, expect, test } from "@playwright/test";
import { FEEDBACK_ENDPOINT } from "../src/feedback.ts";

/** The exit answer from /api/exit, and which DNS test addresses Vessel's resolvers hide (see dns.spec.ts). */
async function network(page: Page, exit: { region: string | null; ipv6: boolean } | "fail", hidden: number[]) {
  await page.route("**/api/exit", (route) =>
    exit === "fail" ? route.fulfill({ status: 502, body: "bad gateway" }) : route.fulfill({ json: exit }));
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
  await page.route(/https:\/\/vessel-dns-(\d)\.anoni\.net\/check/, (route) => {
    const n = Number(/vessel-dns-(\d)/.exec(route.request().url())![1]);
    return hidden.includes(n) ? route.abort("namenotresolved") : route.fulfill({ status: 200, body: "ok\n" });
  });
}

test("a passing check, carried into feedback", async ({ page }) => {
  await network(page, { region: "sg", ipv6: false }, [1, 2]);
  const sent: { data: Record<string, string> }[] = [];
  await page.route(FEEDBACK_ENDPOINT, async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { data: { id: "r1" } } });
  });
  await page.goto("/check/");
  await page.getByRole("button", { name: "開始檢測" }).click();
  const box = page.getByTestId("connection-check");
  await expect(box.getByTestId("check-exit")).toHaveText("經過 Vessel 的新加坡節點。");
  await expect(box.getByTestId("check-dns")).toHaveText("正在使用 Vessel 的 DNS，會擋下惡意網站。");
  await expect(box.getByRole("status")).toContainText("兩項都通過，連線經過 Vessel，DNS 也由 Vessel 處理。");
  await expect(box.getByRole("button", { name: "再檢測一次" })).toBeVisible();

  await box.getByRole("link", { name: "附上結果寫意見回覆" }).click();
  await expect(page).toHaveURL(/\/feedback\/\?from=check&check=sg\.malware$/);
  const attach = page.getByTestId("attach-check");
  await expect(attach).toContainText("連線檢測：出口 新加坡節點，DNS 擋惡意網站");
  await expect(attach.getByRole("checkbox")).toBeChecked();
  await page.getByLabel("連不上或常斷線").check();
  await page.getByLabel("發生了什麼事？").fill("有些網站打不開，想確認是不是過濾的關係");
  await page.getByRole("button", { name: "送出" }).click();
  await expect(page.getByTestId("feedback-sent")).toBeVisible();
  expect(sent[0].data.message).toBe("有些網站打不開，想確認是不是過濾的關係\n\n連線檢測：出口 新加坡節點，DNS 擋惡意網站");
  expect(sent[0].data.from).toBe("check");
});

for (const [exit, hidden, exitText] of [
  [{ region: null, ipv6: false }, [], "沒有經過 Vessel。"],
  [{ region: null, ipv6: true }, [1], "這次連線走 IPv6，沒有經過 Vessel。"],
  ["fail", [1, 2, 3], "無法完成出口的檢測，請稍後再試。"],
] as const) {
  test(`a failing exit: ${JSON.stringify(exit)}`, async ({ page }) => {
    await network(page, exit, [...hidden]);
    await page.goto("/check/");
    await page.getByRole("button", { name: "開始檢測" }).click();
    const box = page.getByTestId("connection-check");
    await expect(box.getByTestId("check-exit")).toContainText(exitText);
    await expect(box.getByRole("status")).toContainText("有項目沒有通過，可以參考下方的處理方式，或把結果附在意見回覆裡。");
  });
}

test("the result can be left out, and a made-up one is ignored", async ({ page }) => {
  await network(page, { region: "jp", ipv6: false }, []);
  await page.goto("/feedback/?from=check&check=jp.notVessel");
  const attach = page.getByTestId("attach-check");
  await expect(attach).toContainText("出口 東京節點，DNS 沒有使用 Vessel 的 DNS");
  await attach.getByRole("checkbox").uncheck();
  await expect(attach.getByRole("checkbox")).not.toBeChecked();
  await page.goto("/feedback/?from=check&check=<b>x</b>.ads");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("意見回覆");
  await expect(page.getByTestId("attach-check")).toHaveCount(0);
});

test("the check page in three languages, linked from the footer and the DNS page", async ({ page }) => {
  await network(page, { region: "sg", ipv6: false }, [1]);
  await page.goto("/dns/");
  await page.getByTestId("dns-check").getByRole("link", { name: "連線檢測" }).click();
  await expect(page).toHaveURL(/\/check\/$/);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["沒有通過時的處理"]);
  await expect(page.getByRole("heading", { level: 3 })).toHaveText(["出口的問題", "DNS 的問題", "兩項都通過的情況"]);
  await page.goto("/en/");
  await page.locator("footer").getByRole("link", { name: "Connection check" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connection check");
  await page.getByRole("button", { name: "Start the check" }).click();
  await expect(page.getByTestId("check-exit")).toHaveText("Through Vessel's Singapore node.");
  await page.goto("/zh-cn/check/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("连接检测");
});
