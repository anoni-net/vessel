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
  await expect(box.getByRole("status")).toContainText("兩項都通過");
  // on Vessel the network checks would test the node, so the page says how to see the visitor's own network
  await expect(box.getByTestId("check-network-hint")).toHaveText("想看目前網路的狀況，先關掉 VPN 再檢測一次。");
  await expect(box.getByTestId("check-network")).toHaveCount(0);
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

test("not connected at all: a plain summary, not a warning, and on to the network", async ({ page }) => {
  await network(page, { region: null, ipv6: false }, []);
  await page.goto("/check/");
  await page.getByRole("button", { name: "開始檢測" }).click();
  const box = page.getByTestId("connection-check");
  await expect(box.getByRole("status")).toHaveText("目前沒有連上 Vessel。下方是目前網路的狀況。要檢查 Vessel 的連線，先在 App 打開通道再檢測一次。");
  await expect(box.locator(".check-verdict--bad")).toHaveCount(0);
  await expect(box.getByTestId("check-exit")).toContainText("可能是 VPN 沒有開");
  await expect(box.getByTestId("check-network")).toBeVisible();
  await expect(box.getByTestId("check-network-hint")).toHaveCount(0);
  expect(Math.abs(await iconOffset(box.getByRole("status")))).toBeLessThan(1);
});

for (const [exit, hidden, exitText] of [
  // Vessel's DNS without its exit: half set up, which is a problem
  [{ region: null, ipv6: false }, [1], "可能是 VPN 沒有開"],
  [{ region: null, ipv6: true }, [1], "這次連線走 IPv6，沒有經過 Vessel。"],
  ["fail", [1, 2, 3], "無法完成出口的檢測，請稍後再試。"],
] as const) {
  test(`a failing exit: ${JSON.stringify(exit)}`, async ({ page }) => {
    await network(page, exit, [...hidden]);
    await page.goto("/check/");
    await page.getByRole("button", { name: "開始檢測" }).click();
    const box = page.getByTestId("connection-check");
    await expect(box.getByTestId("check-exit")).toContainText(exitText);
    await expect(box.getByRole("status")).toContainText("有項目沒有通過");
    expect(Math.abs(await iconOffset(box.getByRole("status")))).toBeLessThan(1);
  });
}

for (const [notices, words] of [
  [[{ region: "sg", kind: "restart", starts_at: "2026-11-08T01:56:33Z", ends_at: "2026-11-08T01:57:33Z" }], /^新加坡節點：正常。最近一次紀錄是 .+ 的節點重新啟動。服務狀態$/],
  [[{ region: null, kind: "maintenance", starts_at: "2026-11-08T01:56:33Z", ends_at: null }], /^新加坡節點：正常。維護進行中。服務狀態$/],
  [[{ region: "jp", kind: "outage", starts_at: "2026-11-08T01:56:33Z", ends_at: "2026-11-08T02:56:33Z" }], /^新加坡節點：正常。最近 30 天沒有維護或中斷的紀錄。服務狀態$/],
] as const) {
  test(`through a node, the check says how that node is doing: ${words}`, async ({ page }) => {
    await network(page, { region: "sg", ipv6: false }, [1, 2]);
    await page.route("**/api/status", (route) => route.fulfill({ json: { regions: [{ id: "jp", state: "ok" }, { id: "sg", state: "ok" }], notices } }));
    await page.goto("/check/");
    await page.getByRole("button", { name: "開始檢測" }).click();
    const node = page.getByTestId("check-node");
    await expect(node).toHaveText(words);
    await expect(node.getByRole("link", { name: "服務狀態" })).toHaveAttribute("href", "/status/");
  });
}

test("through a node that cannot open a site, the check points to the status page", async ({ page }) => {
  await network(page, { region: "jp", ipv6: false }, [1, 2]);
  await page.route("**/api/status", (route) => route.fulfill({ json: { regions: [{ id: "jp", state: "ok" }, { id: "tw", state: "ok" }], notices: [], reach: [   { region: "jp", checked_at: "2026-11-08T04:20:00Z", sites: { mvdis: "blocked", momo: "blocked", bot: "challenge", ptt: "blocked", signal: "ok" } },   { region: "tw", checked_at: "2026-11-08T04:25:00Z", sites: { mvdis: "ok", momo: "ok", bot: "ok", ptt: "blocked", signal: "ok" } }, ] } }));
  await page.goto("/check/");
  await page.getByRole("button", { name: "開始檢測" }).click();
  // no site is named: which ones matter depends on where the visitor lives, and the status page groups them by region
  const note = page.getByTestId("check-reach");
  await expect(note).toHaveText("有些網站會擋國外或機房的 IP，東京節點打不開的網站列在各城市打不開的網站。");
  await expect(note.getByRole("link")).toHaveAttribute("href", "/status/#reach");
});

test("off Vessel, or when the status cannot be read, there is no line about a node", async ({ page }) => {
  await network(page, { region: null, ipv6: false }, []);
  await page.route("**/api/status", (route) => route.fulfill({ json: { regions: [{ id: "sg", state: "ok" }], notices: [] } }));
  await page.goto("/check/");
  await page.getByRole("button", { name: "開始檢測" }).click();
  await expect(page.getByTestId("check-network")).toBeVisible();
  await expect(page.getByTestId("check-node")).toHaveCount(0);
  await page.unroute("**/api/exit");
  await page.route("**/api/exit", (route) => route.fulfill({ json: { region: "sg", ipv6: false } }));
  await page.unroute("**/api/status");
  await page.route("**/api/status", (route) => route.fulfill({ status: 500, json: { error: "x" } }));
  await page.getByRole("button", { name: "再檢測一次" }).click();
  await expect(page.getByTestId("check-exit")).toContainText("新加坡節點");
  await expect(page.getByTestId("check-node")).toHaveCount(0);
});

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
    "經過 Vessel 東京節點的舊主機。裝置的設定檔很快就不能連線，請到「我的裝置」新增一台裝置、匯入新的設定檔。");
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
  await expect(box.getByRole("heading")).toHaveText("網路業者的公開量測");
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
  await expect(box.getByRole("link", { name: "到 OONI Explorer 查看完整資料" })).toHaveAttribute("href", "https://explorer.ooni.org/as/AS64500");
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

test("the statuses line up at the right edge, whatever the length of the name", async ({ page }) => {
  await network(page, { region: null, ipv6: false }, [1]);
  await page.goto("/check/");
  await page.getByRole("button", { name: "開始檢測" }).click();
  const badges = page.getByTestId("check-network").locator("li .badge");
  await expect(badges).toHaveCount(5);
  const rights = await badges.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
  expect(new Set(rights).size).toBe(1);
  // each on the same line as its name
  const row = page.getByTestId("check-network").locator("li").first();
  const name = await row.locator(".strong").boundingBox();
  const badge = await row.locator(".badge").boundingBox();
  expect(Math.abs(name!.y + name!.height / 2 - (badge!.y + badge!.height / 2))).toBeLessThan(2);
});

// a sentence that runs into a link has no space of its own, so the space has to be in the sentence
const NO_SPACE = /[\u4e00-\u9fff][A-Za-z0-9]|[A-Za-z0-9][\u4e00-\u9fff]/;

test("Chinese and Latin text keep a space between them where a sentence runs into a link", async ({ page }) => {
  await network(page, { region: null, ipv6: false }, [1]);
  await page.goto("/check/");
  await page.getByRole("button", { name: "開始檢測" }).click();
  await expect(page.getByTestId("check-network").locator("li")).toHaveCount(5);
  expect(NO_SPACE.exec(await page.getByTestId("check-network").innerText())).toBeNull();
  await page.goto("/dns/lists/");
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
  expect(NO_SPACE.exec(await page.locator(".lists-page").innerText())).toBeNull();
});

test("each check has its status at the right, and the words below it", async ({ page }) => {
  await network(page, { region: null, ipv6: false }, [0, 1, 2, 3]);
  await page.goto("/check/");
  await page.getByRole("button", { name: "開始檢測" }).click();
  const rows = page.getByTestId("connection-check").locator("dl.check-rows > div");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator("dt")).toHaveText("連線經過 Vessel 節點");
  await expect(rows.nth(0).locator(".badge")).toHaveText("沒有通過");
  await expect(rows.nth(1).locator("dt")).toHaveText("DNS 由 Vessel 處理");
  const name = await rows.nth(0).locator("dt").boundingBox();
  const badge = await rows.nth(0).locator(".badge").boundingBox();
  const detail = await rows.nth(0).getByTestId("check-exit").boundingBox();
  expect(Math.abs(name!.y + name!.height / 2 - (badge!.y + badge!.height / 2))).toBeLessThan(2);
  expect(detail!.y).toBeGreaterThan(badge!.y + badge!.height - 1);
});

test("a pass reads as a pass", async ({ page }) => {
  await network(page, { region: "sg", ipv6: false }, [1, 2]);
  await page.goto("/check/");
  await page.getByRole("button", { name: "開始檢測" }).click();
  const rows = page.getByTestId("connection-check").locator("dl.check-rows > div");
  await expect(rows.nth(0).locator(".badge")).toHaveText("通過");
  await expect(rows.nth(1).locator(".badge")).toHaveText("通過");
});

/** Replaces RTCPeerConnection: "pass" answers with a server-reflexive candidate (carrying a public address the page must
 * never show), "fail" gathers only a host candidate, "silent" never finishes, "none" is a browser without WebRTC. */
async function webrtc(page: Page, mode: "pass" | "fail" | "silent" | "none") {
  await page.addInitScript((mode) => {
    const w = window as unknown as Record<string, unknown>;
    w.__stun = { urls: [] as string[], closed: 0 };
    if (mode === "none") {
      delete w.RTCPeerConnection;
      return;
    }
    const line = (typ: string, ip: string) => `candidate:1 1 udp 1 ${ip} 50000 typ ${typ}`;
    class FakePeer extends EventTarget {
      onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
      constructor(config: RTCConfiguration) {
        super();
        (w.__stun as { urls: string[] }).urls.push(String(config.iceServers?.[0]?.urls));
      }
      createDataChannel() { return {}; }
      async createOffer() { return { type: "offer", sdp: "" }; }
      async setLocalDescription() {
        if (mode === "silent") return;
        const emit = (candidate: unknown) => setTimeout(() => this.onicecandidate?.({ candidate }), 50);
        emit({ type: "host", candidate: line("host", "abc.local") });
        if (mode === "pass") emit({ type: "srflx", candidate: line("srflx", "203.0.113.9") });
        else emit(null);
      }
      close() { (w.__stun as { closed: number }).closed += 1; }
    }
    w.RTCPeerConnection = FakePeer;
  }, mode);
}

async function withStun(page: Page) {
  await page.route("**/api/network", (route) => route.fulfill({ json: { asn: 64500, name: "EXAMPLE - Example Network", days: 30, tests: [], stun: "stun.example:443" } }));
}

test("off Vessel the check sends UDP to the STUN server, and never shows the address it learns", async ({ page }) => {
  await network(page, { region: null, ipv6: false }, [1]);
  await withStun(page);
  await webrtc(page, "pass");
  await page.goto("/check/");
  await page.getByRole("button", { name: "開始檢測" }).click();
  const box = page.getByTestId("check-udp");
  await expect(box.getByRole("heading")).toHaveText("UDP 連線");
  await expect(box.locator(".badge")).toHaveText("通過");
  await expect(box).toHaveAttribute("aria-busy", "false");
  await expect(box).toContainText("目前的網路可以送出 UDP");
  expect(await page.evaluate(() => (window as unknown as { __stun: unknown }).__stun)).toEqual({ urls: ["stun:stun.example:443"], closed: 1 });
  expect(await page.content()).not.toContain("203.0.113.9");
  // it comes before OONI's measurements, which still show
  const [udp, ooni] = await Promise.all([box.boundingBox(), page.getByTestId("check-network").boundingBox()]);
  expect(udp!.y).toBeLessThan(ooni!.y);
});

for (const [mode, badge, words] of [
  ["fail", "沒有通過", "測試用的埠跟 Vessel 不同"],
  ["none", "無法判斷", "瀏覽器沒有開放 WebRTC"],
] as const) {
  test(`a UDP check that ends ${mode} says so`, async ({ page }) => {
    await network(page, { region: null, ipv6: false }, [1]);
    await withStun(page);
    await webrtc(page, mode);
    await page.goto("/check/");
    await page.getByRole("button", { name: "開始檢測" }).click();
    const box = page.getByTestId("check-udp");
    await expect(box.locator(".badge")).toHaveText(badge);
    await expect(box).toContainText(words);
  });
}

test("no answer from the STUN server within 5 seconds is a fail", async ({ page }) => {
  await page.clock.install();
  await network(page, { region: null, ipv6: false }, [1]);
  await withStun(page);
  await webrtc(page, "silent");
  await page.goto("/check/");
  await page.getByRole("button", { name: "開始檢測" }).click();
  const box = page.getByTestId("check-udp");
  await expect(box).toContainText("測試中");
  await expect(box).toHaveAttribute("aria-busy", "true");
  await page.clock.runFor(5100);
  await expect(box.locator(".badge")).toHaveText("沒有通過");
  expect(await page.evaluate(() => (window as unknown as { __stun: { closed: number } }).__stun.closed)).toBe(1);
});

test("without a STUN server, or through a Vessel node, there is no UDP check", async ({ page }) => {
  await network(page, { region: null, ipv6: false }, [1]);
  await webrtc(page, "pass");
  await page.goto("/check/");
  await page.getByRole("button", { name: "開始檢測" }).click();
  await expect(page.getByTestId("check-network").locator("li")).toHaveCount(5);
  await expect(page.getByTestId("check-udp")).toHaveCount(0);
  await withStun(page);
  await page.route("**/api/exit", (route) => route.fulfill({ json: { region: "sg", ipv6: false } }));
  await page.getByRole("button", { name: "再檢測一次" }).click();
  await expect(page.getByTestId("check-exit")).toContainText("新加坡");
  await expect(page.getByTestId("check-udp")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __stun: { urls: string[] } }).__stun.urls)).toEqual([]);
});
