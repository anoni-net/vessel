import { x25519 } from "@noble/curves/ed25519.js";
import { type Page, expect, test } from "@playwright/test";

const ME = { created_on: "2026-10-27", last_login_on: "2026-10-27", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 0 };
const NODE = {
  interface: { Address: "10.8.1.7/32", DNS: "10.8.1.254", MTU: "1280", Jc: "5", Jmin: "20", Jmax: "90", S1: "12", I1: "<r 2><b 0x0100>" },
  peer: { PublicKey: "srvkey", AllowedIPs: "0.0.0.0/0, ::/0", Endpoint: "198.51.100.1:443", PersistentKeepalive: "25-35" },
};
const KEY = /^[A-Za-z0-9+/]{43}=$/;
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function mock(page: Page, opts: { pending?: boolean; createError?: string; devices?: unknown[] } = {}) {
  const posted: Record<string, string>[] = [];
  let polls = 0;
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: ME });
    if (path === "/api/devices" && req.method() === "GET") return route.fulfill({ json: opts.devices ?? [] });
    if (path === "/api/regions") return route.fulfill({ json: [{ id: "jp", open: false }, { id: "sg", open: true }] });
    if (path === "/api/devices" && req.method() === "POST") {
      expect(req.headers()["x-vessel-request"]).toBe("1");
      posted.push(req.postDataJSON());
      if (opts.createError) return route.fulfill({ status: 409, json: { error: opts.createError } });
      return opts.pending
        ? route.fulfill({ status: 202, json: { id: "d-abcdef123456", status: "pending" } })
        : route.fulfill({ json: { id: "d-abcdef123456", status: "active", config: NODE } });
    }
    if (path === "/api/devices/d-abcdef123456/config") {
      polls++;
      return polls < 2 ? route.fulfill({ status: 202, json: { status: "pending" } }) : route.fulfill({ json: { status: "active", config: NODE } });
    }
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  return posted;
}

async function throughToName(page: Page) {
  await page.goto("/devices/new/");
  await page.getByRole("button", { name: "已經安裝，下一步" }).click();
  await expect(page.getByRole("button", { name: /東京/ })).toBeDisabled();
  await page.getByRole("button", { name: /新加坡/ }).click();
  await page.getByLabel("裝置名稱").fill("手機");
}

test("create a device with keys made in the browser", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  const posted = await mock(page);
  await throughToName(page);
  await page.getByLabel(/擋惡意網站與廣告/).check();
  await page.getByRole("button", { name: "產生設定檔" }).click();
  await expect(page.getByRole("heading", { name: "匯入 AmneziaWG" })).toBeVisible();

  const body = posted[0];
  expect(body).toMatchObject({ name: "手機", region: "sg", dns_filter: "ads" });
  expect(body.public_key).toMatch(KEY);
  expect(body.preshared_key).toMatch(KEY);
  expect(body).not.toHaveProperty("private_key");

  await page.getByRole("button", { name: "顯示設定檔的文字內容" }).click();
  const text = await page.getByTestId("config-text").innerText();
  const priv = /PrivateKey = (\S+)/.exec(text)![1];
  // the private key in the file belongs to the public key the backend got, and never left the page
  expect(Buffer.from(x25519.getPublicKey(b64(priv))).toString("base64")).toBe(body.public_key);
  expect(JSON.stringify(posted)).not.toContain(priv);
  expect(text).toContain(`PresharedKey = ${body.preshared_key}`);
  expect(text).toContain("Endpoint = 198.51.100.1:443");
  expect(text).toContain("I1 = <r 2><b 0x0100>");

  await page.getByRole("button", { name: /顯示 QR code/ }).click();
  await expect(page.getByRole("img", { name: "設定檔的 QR code" }).locator("svg")).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載設定檔" }).click();
  expect((await download).suggestedFilename()).toBe("vessel-sg-abcdef.conf");

  await page.getByRole("link", { name: "我已經匯入，完成" }).click();
  await expect(page).toHaveURL(/\/devices\/$/);
  // the lazily loaded page, the QR code and the meter's width all work under the production CSP
  expect(violations).toEqual([]);
});

test("waits for a slow node", async ({ page }) => {
  await mock(page, { pending: true });
  await throughToName(page);
  await page.getByRole("button", { name: "產生設定檔" }).click();
  await expect(page.getByRole("status")).toHaveText("節點正在加入這台裝置，請稍候，不要離開這一頁。");
  await expect(page.getByRole("heading", { name: "匯入 AmneziaWG" })).toBeVisible({ timeout: 10_000 });
});

test("errors on create are shown", async ({ page }) => {
  await mock(page, { createError: "device_limit" });
  await throughToName(page);
  await page.getByRole("button", { name: "產生設定檔" }).click();
  await expect(page.getByRole("alert")).toHaveText("這個帳號的裝置已經到上限。");
});

test("install step switches platforms", async ({ page }) => {
  await mock(page);
  await page.goto("/en/devices/new/");
  await page.getByRole("button", { name: "iPhone and Mac" }).click();
  await expect(page.getByRole("link", { name: "Get it on the App Store" })).toHaveAttribute("href", /apps\.apple\.com/);
  await page.getByRole("button", { name: "Windows" }).click();
  await expect(page.getByRole("link", { name: "Download the Windows installer" })).toBeVisible();
});

test("the add button disappears at the device limit", async ({ page }) => {
  const d = (id: string) => ({ id, name: id, region: "sg", dns_filter: "none", status: "active", created_on: "2026-10-27", expires_on: "2026-11-26" });
  await mock(page, { devices: [d("a"), d("b")] });
  await page.goto("/devices/");
  await expect(page.getByRole("link", { name: "新增裝置" })).toBeVisible();
  await page.unrouteAll();
  await mock(page, { devices: [d("a"), d("b"), d("c")] });
  await page.reload();
  await expect(page.getByTestId("device-list").getByText("c", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "新增裝置" })).toHaveCount(0);
});

test("the install step explains AmneziaWG through the FAQ", async ({ page }) => {
  await mock(page);
  await page.goto("/devices/new/");
  await page.getByRole("link", { name: "VPN、WireGuard 與 AmneziaWG 有什麼關係？" }).click();
  await expect(page).toHaveURL(/\/faq\/#q-protocols$/);
  await expect(page.locator("#q-protocols")).toHaveAttribute("open", "");
  await expect(page.getByText("AmneziaWG 是從 WireGuard 修改而來的開源專案")).toBeVisible();
  await expect(page.locator("#q-maker")).not.toHaveAttribute("open", "");
});
