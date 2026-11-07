import { type Locator, type Page, expect, test } from "@playwright/test";
import { FEEDBACK_ENDPOINT } from "../src/feedback.ts";

/** The exit answer from /api/exit, and which DNS test addresses Vessel's resolvers hide (see dns.spec.ts). */
async function network(page: Page, exit: { region: string | null; ipv6: boolean; previous?: boolean } | "fail", hidden: number[]) {
  await page.route("**/api/exit", (route) =>
    exit === "fail" ? route.fulfill({ status: 502, body: "bad gateway" }) : route.fulfill({ json: exit }));
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
  await page.route("**/api/network", (route) => route.fulfill({ json: { asn: 64500, name: "EXAMPLE - Example Network", days: 30, tests: [
    { id: "web_connectivity", level: "ok", measurements: 26203, anomaly_pct: 3, confirmed: 407 },
    { id: "signal", level: "most", measurements: 100, anomaly_pct: 99, confirmed: 0 },
    { id: "telegram", level: "some", measurements: 100, anomaly_pct: 30, confirmed: 0 },
    { id: "whatsapp", level: "few", measurements: 3, anomaly_pct: 0, confirmed: 0 },
    { id: "tor", level: "unknown", measurements: 0, anomaly_pct: 0, confirmed: 0 },
  ] } }));
  await page.route(/https:\/\/vessel-dns-(\d)\.anoni\.net\/check/, (route) => {
    const n = Number(/vessel-dns-(\d)/.exec(route.request().url())![1]);
    return hidden.includes(n) ? route.abort("namenotresolved") : route.fulfill({ status: 200, body: "ok\n" });
  });
}

/** How far the verdict's icon sits from the middle of the first line of its words, in px. */
async function iconOffset(verdict: Locator) {
  return verdict.evaluate((p) => {
    const icon = p.querySelector(".icon")!.getBoundingClientRect();
    const style = getComputedStyle(p);
    const line = p.getBoundingClientRect().top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2;
    return icon.top + icon.height / 2 - line;
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
  expect(Math.abs(await iconOffset(box.getByRole("status")))).toBeLessThan(1);

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
    expect(Math.abs(await iconOffset(box.getByRole("status")))).toBeLessThan(1);
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

test("a config made before the region moved host goes out through the old server", async ({ page }) => {
  await network(page, { region: "jp", ipv6: false, previous: true }, [1, 2]);
  await page.goto("/check/");
  await page.getByRole("button", { name: "開始檢測" }).click();
  const box = page.getByTestId("connection-check");
  await expect(box.getByTestId("check-exit")).toHaveText(
    "經過 Vessel 東京節點的舊主機。這個設定檔很快就不能連線，請到「我的裝置」新增一台裝置、匯入新的設定檔。");
  await expect(box.getByRole("link", { name: "前往我的裝置" })).toHaveAttribute("href", "/devices/");
  await box.getByRole("link", { name: "附上結果寫意見回覆" }).click();
  await expect(page).toHaveURL(/check=old-jp\.malware$/);
  await expect(page.getByTestId("attach-check")).toContainText("出口 東京節點的舊主機");
});

test("off Vessel the check shows OONI's measurements of this network, and asks nothing on Vessel", async ({ page }) => {
  await network(page, { region: null, ipv6: false }, [1]);
  let visited = 0;
  page.on("request", (r) => { if (r.url().includes("ooni")) visited += 1; });
  await page.goto("/check/");
  await expect(page.getByTestId("check-network")).toHaveCount(0);
  await page.getByRole("button", { name: "開始檢測" }).click();
  const box = page.getByTestId("check-network");
  await expect(box).toContainText("EXAMPLE - Example Network（AS64500）過去 30 天");
  await expect(box).toHaveAttribute("aria-busy", "false");
  const rows = box.locator("li");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText("看起來正常");
  await expect(rows.nth(0)).toContainText("26,203 筆，異常 3%，確認封鎖 407 筆");
  await expect(rows.nth(1)).toContainText("多數量測異常");
  await expect(rows.nth(3)).toContainText("資料不足");
  await expect(rows.nth(4)).toContainText("暫時查不到");
  await expect(box.getByRole("link", { name: "常見問題的這一題" })).toHaveAttribute("href", "/faq/#q-risky");
  await expect(box.getByRole("link", { name: "OONI Probe" })).toHaveAttribute("href", "https://ooni.org/install/");
  await expect(box.getByRole("link", { name: "到 OONI Explorer 看這個網路的細節" })).toHaveAttribute("href", "https://explorer.ooni.org/as/AS64500");
  await expect(box.getByRole("link", { name: "CC BY-NC-SA 4.0" })).toBeVisible();
  // the browser itself never reaches OONI or the services it reports on
  expect(visited).toBe(0);
});

test("a network nobody can name says so", async ({ page }) => {
  await network(page, { region: null, ipv6: false }, [1]);
  await page.route("**/api/network", (route) => route.fulfill({ json: { asn: null, name: null, days: 30, tests: [] } }));
  await page.goto("/check/");
  await page.getByRole("button", { name: "開始檢測" }).click();
  await expect(page.getByTestId("check-network")).toContainText("無法判斷目前的網路業者");
});

test("through a Vessel node there is no network section", async ({ page }) => {
  await network(page, { region: "sg", ipv6: false }, [1]);
  await page.goto("/check/");
  await page.getByRole("button", { name: "開始檢測" }).click();
  await expect(page.getByTestId("check-exit")).toBeVisible();
  await expect(page.getByTestId("check-network")).toHaveCount(0);
});
