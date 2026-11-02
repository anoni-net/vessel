import { type Page, type Route, expect, test } from "@playwright/test";

// Passkeys end to end in the browser: Chrome's virtual authenticator (CDP WebAuthn) stands in for the password
// manager, and the backend is mocked. A relying party ID cannot be an IP address, so these pages load from
// localhost and the mocked options name localhost as the relying party.
const SITE = "http://localhost:4174";
const ME = { created_on: "2026-10-27", last_login_on: "2026-10-27", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 0 };
const b64 = (s: string) => Buffer.from(s).toString("base64url");

test.skip(({ browserName }) => browserName !== "chromium", "the virtual authenticator is a Chrome DevTools feature");

async function authenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true,
      isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

const creation = (exclude: string[] = []) => ({
  rp: { id: "localhost", name: "Vessel" },
  user: { id: b64("account-handle"), name: "Vessel 2026-10-27", displayName: "Vessel 2026-10-27" },
  challenge: b64("register-challenge"),
  pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
  timeout: 5000,
  excludeCredentials: exclude.map((id) => ({ type: "public-key", id })),
  authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  attestation: "none",
});
const request = (allow: string[] = [], timeout = 5000) => ({
  rpId: "localhost", challenge: b64("sign-challenge"), timeout, userVerification: "preferred",
  allowCredentials: allow.map((id) => ({ type: "public-key", id })),
});

type Handler = (route: Route) => Promise<void> | void;
async function backend(page: Page, handlers: Record<string, Handler>) {
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    if (req.method() !== "GET") expect(req.headers()["x-vessel-request"]).toBe("1");
    const handler = handlers[`${req.method()} ${new URL(req.url()).pathname}`];
    return handler ? handler(route) : route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}
const json = (body: unknown, status = 200): Handler => (route) => route.fulfill({ status, json: body });

test("add a passkey on the account page, sign in with it, and get a new account number", async ({ page }) => {
  await authenticator(page);
  const stored: { id: number; label: string; created_on: string }[] = [];
  let made: Record<string, any> | undefined;
  let signedWith: Record<string, any> | undefined;
  let signedIn = true;
  await backend(page, {
    "GET /api/me": (route) => route.fulfill(signedIn ? { json: ME } : { status: 401, json: { error: "signed_out" } }),
    "GET /api/devices": json([]),
    "GET /api/passkeys": (route) => route.fulfill({ json: stored }),
    "POST /api/passkeys/options": json(creation()),
    "POST /api/passkeys": (route) => {
      const body = route.request().postDataJSON();
      made = body.credential;
      stored.push({ id: 1, label: body.label, created_on: "2026-10-31" });
      return route.fulfill({ json: stored });
    },
    "POST /api/passkeys/login/options": json(request()),
    "POST /api/passkeys/login": (route) => {
      signedWith = route.request().postDataJSON().credential;
      signedIn = true;
      return route.fulfill({ json: { ok: true } });
    },
    "POST /api/account/number/options": (route) => route.fulfill({ json: request([made!.id]) }),
    "POST /api/account/number": json({ account_number: "1111 2222 3333 4444" }),
    "POST /api/logout": (route) => { signedIn = false; return route.fulfill({ json: { ok: true } }); },
  });

  await page.goto(SITE + "/account/");
  const box = page.getByTestId("passkeys");
  await box.getByLabel("名稱").fill("測試用的鑰匙");
  await box.getByRole("button", { name: "加上 passkey" }).click();
  await expect(box.getByText("測試用的鑰匙")).toBeVisible();
  // what the backend gets: the attestation, as JSON with base64url fields, and the name
  expect(made!.response.attestationObject).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(made!.response.clientDataJSON).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(JSON.parse(Buffer.from(made!.response.clientDataJSON, "base64url").toString())).toMatchObject({
    type: "webauthn.create", challenge: b64("register-challenge"), origin: SITE,
  });

  // replacing the number signs with the account's passkey, then shows the new number once
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("rotate").getByRole("button", { name: "用 passkey 換一組號碼" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("這是你的新帳號號碼");
  await expect(page.getByTestId("account-number")).toHaveText("1111 2222 3333 4444");
  await page.getByLabel("我已經把號碼存在安全的地方").check();
  await page.getByRole("button", { name: "繼續" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("帳號");

  // signed out, the sign-in page needs no number: the browser offers the passkey made above
  await page.getByRole("button", { name: "登出" }).click();
  await page.goto(SITE + "/login/");
  await page.getByTestId("passkey-login").getByRole("button", { name: "用 passkey 登入" }).click();
  await expect(page).toHaveURL(/\/devices\/$/);
  expect(signedWith!.id).toBe(made!.id);
  expect(signedWith!.response.userHandle).toBe(b64("account-handle"));
  expect(signedWith!.response.signature).toMatch(/^[A-Za-z0-9_-]+$/);
});

test("right after redeeming, a passkey is offered and added", async ({ page }) => {
  await authenticator(page);
  let added = false;
  await backend(page, {
    "POST /api/redeem": json({ account_number: "4821 0937 5564 2018" }),
    "GET /api/me": json(ME),
    "GET /api/devices": json([]),
    "POST /api/passkeys/options": json(creation()),
    "POST /api/passkeys": (route) => { added = true; return route.fulfill({ json: [{ id: 1, label: "", created_on: "2026-10-31" }] }); },
  });
  await page.goto(SITE + "/redeem/");
  await page.getByLabel("邀請碼").fill("abcd-efgh-jkmn-pqrs");
  await page.getByRole("button", { name: "兌換" }).click();
  await page.getByLabel("我已經把號碼存在安全的地方").check();
  await page.getByRole("button", { name: "繼續" }).click();
  const offer = page.getByTestId("passkey-offer");
  await expect(offer.getByRole("heading", { level: 1 })).toHaveText("加上 passkey");
  await offer.getByRole("button", { name: "加上 passkey" }).click();
  await expect(page).toHaveURL(/\/devices\/$/);
  expect(added).toBe(true);
});

test("no passkey to offer: the sign-in says so and the number form stays", async ({ page }) => {
  await authenticator(page);
  await backend(page, {
    "GET /api/me": json({ error: "signed_out" }, 401),
    // asks for a credential this browser does not have, so the authenticator has nothing to answer with
    "POST /api/passkeys/login/options": json(request([b64("someone-else")], 1500)),
  });
  await page.goto(SITE + "/login/");
  await page.getByRole("button", { name: "用 passkey 登入" }).click();
  await expect(page.getByTestId("passkey-login").getByRole("alert")).toHaveText("沒有完成 passkey 的確認，可以再試一次。");
  await expect(page.getByLabel("帳號號碼")).toBeVisible();
});

test("the account page lists passkeys, removes one, and stops at five", async ({ page }) => {
  const five = [1, 2, 3, 4, 5].map((id) => ({ id, label: id === 1 ? "" : `key ${id}`, created_on: "2026-10-31" }));
  let list = five;
  await backend(page, {
    "GET /api/me": json(ME),
    "GET /api/passkeys": (route) => route.fulfill({ json: list }),
    "DELETE /api/passkeys/1": (route) => { list = five.slice(1); return route.fulfill({ json: list }); },
  });
  await page.goto(SITE + "/account/");
  const box = page.getByTestId("passkeys");
  await expect(box.locator(".passkey-list li")).toHaveCount(5);
  await expect(box.getByText("已經有 5 個 passkey，刪除一個之後才能再加。")).toBeVisible();
  await expect(box.getByRole("button", { name: "加上 passkey" })).toHaveCount(0);
  page.once("dialog", (d) => { expect(d.message()).toBe("刪除「未命名的 passkey」？之後就不能用它登入。"); return d.accept(); });
  await box.locator(".passkey-list li").first().getByRole("button", { name: "刪除" }).click();
  await expect(box.locator(".passkey-list li")).toHaveCount(4);
  await expect(box.getByRole("button", { name: "加上 passkey" })).toBeVisible();
});
