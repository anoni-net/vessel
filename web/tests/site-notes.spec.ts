import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";
import { h } from "preact";
import { render } from "preact-render-to-string";
import { check } from "../scripts/site-notes.mjs";
import en from "../src/i18n/en.json" with { type: "json" };
import zhCN from "../src/i18n/zh-CN.json" with { type: "json" };
import zhTW from "../src/i18n/zh-TW.json" with { type: "json" };
import { NoteLine } from "../src/pages/site-note.tsx";
import { AD_NETWORK_REPORT, AD_NETWORK_UNNOTED, KEY, NOTED, NOTES_REPORT, ONCE_START, seal } from "./inspect-fixtures.ts";

// The notes on sites (src/site-notes.ts): matched in the reader's browser against the file bundled with the page, only
// adding to a report and never changing what it comes to, put on the page as text, and checked in CI.

const DATA = JSON.parse(readFileSync(new URL("../src/data/site-notes.json", import.meta.url), "utf-8"));
const MESSAGES = { "zh-TW": zhTW, "zh-CN": zhCN, en };
const TODAY = "2026-11-10";

// the categories' sentences, said once under a kind
const AD = "廣告聯播網：替許多網站投放廣告的服務，打開放了它廣告的網頁時，瀏覽器會自動連過去。經手的廣告曾經導向詐騙或惡意網站，所以也出現在部分惡意網站名單上。";
const REDIRECT = "廣告轉址：點廣告、彈出視窗或新分頁時經過的轉址網站，通常一閃而過就轉到下一個網頁。最後打開的網頁可能是一般廣告，也可能是詐騙或要求安裝 App 的頁面。";

test.describe("the CI check", () => {
  const broken = (change: (d: typeof DATA) => void, today = TODAY) => {
    const d = structuredClone(DATA);
    change(d);
    return check(d, MESSAGES, today);
  };

  test("the file as it is passes", () => {
    expect(check(DATA, MESSAGES, TODAY)).toEqual([]);
    expect(DATA.categories).toEqual(expect.arrayContaining(["ad-network", "ad-redirect", "tracker", "phishing", "c2", "stalkerware-vendor"]));
  });

  test("a broken file fails, saying what is wrong", () => {
    expect(broken((d) => { d.sites[0].category = "adware"; })).toEqual([expect.stringContaining('the category "adware" is not in `categories`')]);
    expect(broken((d) => { d.sites[0].domain = "MagSrv.com"; })[0]).toContain("not a lowercase domain");
    for (const domain of ["magsrv", "-magsrv.com", "mag srv.com", "magsrv.com.", "*.magsrv.com", "https://magsrv.com", "magsrv.c0m"]) {
      expect(broken((d) => { d.sites[0].domain = domain; }), domain).toEqual([expect.stringContaining("not a lowercase domain")]);
    }
    expect(broken((d) => { d.sites.push({ ...d.sites[0], sources: ["https://example.org/other"] }); })).toEqual([expect.stringContaining("magsrv.com): listed twice")]);
    expect(broken((d) => { d.sites[0].sources = []; })).toEqual([expect.stringContaining("no source")]);
    expect(broken((d) => { delete d.sites[0].sources; })).toEqual([expect.stringContaining("no source")]);
    for (const source of ["http://docs.exoclick.com/", "javascript:alert(1)", "//docs.exoclick.com/", "docs.exoclick.com", "https://user:pw@docs.exoclick.com/"]) {
      expect(broken((d) => { d.sites[0].sources = [source]; }), source).toEqual([expect.stringContaining("is not an https:// address")]);
    }
    expect(broken((d) => { d.sites[0].sources.push(d.sites[0].sources[0]); })).toEqual([expect.stringContaining("a source is listed twice")]);
    expect(broken((d) => { d.sites[0].operator = "<b>ExoClick</b>"; })).toEqual([expect.stringContaining("without markup")]);
    expect(broken((d) => { d.sites[0].operator = ""; })).toEqual([expect.stringContaining("without markup")]);
    expect(broken((d) => { d.sites[0].note = "free text"; })).toEqual([expect.stringContaining("unknown keys note")]);
    expect(broken((d) => { d.extra = []; })).toEqual(["unknown keys at the top: extra"]);
    expect(broken((d) => { d.categories.push("ad-network"); })).toEqual(["category ad-network: listed twice"]);
    expect(broken((d) => { d.categories = "ad-network"; })).toContain("`categories` is not a list of category codes");
    expect(check({ categories: ["ad-network"] }, MESSAGES, TODAY)).toEqual(["`sites` is not a list"]);
    expect(check([], MESSAGES, TODAY)).toEqual(["the file is not an object with `categories` and `sites`"]);
  });

  test("every category has a name and a sentence in all three languages", () => {
    expect(broken((d) => { d.categories.push("adware"); })).toEqual([
      "category adware: zh-TW has no notes.adware.name", "category adware: zh-TW has no notes.adware.about",
      "category adware: zh-CN has no notes.adware.name", "category adware: zh-CN has no notes.adware.about",
      "category adware: en has no notes.adware.name", "category adware: en has no notes.adware.about",
    ]);
    const { "notes.c2.about": _, ...withoutOne } = en;
    expect(check(DATA, { ...MESSAGES, en: withoutOne }, TODAY)).toEqual(["category c2: en has no notes.c2.about"]);
    expect(check(DATA, { ...MESSAGES, "zh-CN": { ...zhCN, "notes.tracker.name": "<i>追踪</i>" } }, TODAY))
      .toEqual(["category tracker: zh-CN notes.tracker.name has markup or control characters"]);
  });

  test("a review is a real day, not after today, and less than a year old", () => {
    const one = (reviewed: string, today = TODAY) => broken((d) => { d.sites = [{ ...d.sites[0], reviewed }]; }, today);
    expect(one("2026-11-10")).toEqual([]);
    expect(one("2025-11-10")).toEqual([]);
    expect(one("2025-11-09")).toEqual([expect.stringContaining("is more than a year ago; check the sources again")]);
    // a day ahead for the time zones ahead of UTC, not two
    expect(one("2026-11-11")).toEqual([]);
    expect(one("2026-11-12")).toEqual([expect.stringContaining("is after today")]);
    expect(one("2026-02-30")).toEqual([expect.stringContaining("reviewed is not a day")]);
    expect(one("10/11/2026")).toEqual([expect.stringContaining("reviewed is not a day")]);
    // the file as it is, a year and a day on
    expect(check(DATA, MESSAGES, "2027-11-11")).toHaveLength(DATA.sites.length);
  });

  test("run on its own, it fails on a broken file and passes on the real one", () => {
    const script = new URL("../scripts/site-notes.mjs", import.meta.url).pathname;
    expect(execFileSync("node", [script, "--today", TODAY]).toString()).toContain("all fine");
    const bad = test.info().outputPath("site-notes.json");
    writeFileSync(bad, JSON.stringify({ ...DATA, sites: [...DATA.sites, { domain: "Bad", category: "x", sources: [], reviewed: "2020-01-01" }] }));
    let code = 0;
    let said = "";
    try {
      execFileSync("node", [script, "--data", bad, "--today", TODAY], { stdio: "pipe" });
    } catch (x) {
      code = (x as { status: number }).status;
      said = String((x as { stderr: Buffer }).stderr);
    }
    expect(code).toBe(1);
    expect(said).toContain("not a lowercase domain");
    expect(said).toContain("no source");
    expect(said).toContain("more than a year ago");
  });
});

test("a note's words are text: a name with markup in it is escaped, never markup", () => {
  const note = { domain: "magsrv.com", category: "ad-network", operator: "<b>Ex</b> & <script>x()</script>", sources: ["https://docs.exoclick.com/a?b=1&c=<2>", "javascript:alert(1)"], reviewed: TODAY };
  const html = render(h(NoteLine, { note, t: zhTW }));
  expect(html).toContain("廣告聯播網 &lt;b>Ex&lt;/b> &amp; &lt;script>x()&lt;/script></span>");
  expect(html).not.toContain("<b>");
  expect(html).not.toContain("<script>");
  // only the https:// source is a link, opened in a new tab
  expect(html.match(/<a /g)).toHaveLength(1);
  expect(html).toContain('href="https://docs.exoclick.com/a?b=1&amp;c=&lt;2>" target="_blank" rel="noopener"');
  expect(html).not.toContain("javascript:");
});

// The report: the notes on its sites
test.describe("in a report", () => {
  test.use({ timezoneId: "Asia/Taipei" });

  const plus = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString();
  const running = (report: object) => ({ consent_version: "2026-11-09", days: 7, report_days: 7, status: "active", started_at: ONCE_START, ends_at: plus(ONCE_START, 7), report: seal(report) });
  const ended = (report: object) => ({ ...running(report), status: "ended", report_until: "2026-11-24" });
  /** Opens the report, and keeps every request the page made. */
  const open = async (page: Page, inspection: object, path = "/devices/inspect/?d=d-1") => {
    const asked: string[] = [];
    page.on("request", (r) => asked.push(r.url()));
    await page.clock.setFixedTime(new Date("2026-11-10T07:10:00Z"));
    await page.route("**/api/**", (route) => {
      const p = new URL(route.request().url()).pathname;
      const json = (body: unknown) => route.fulfill({ json: body });
      if (p.endsWith("/inspection")) return json(inspection);
      if (p === "/api/me") return json({ created_on: "2026-10-27", device_limit: 3, monthly_quota_bytes: 50e9, used_bytes: 0, group: null });
      if (p === "/api/devices") return json([{ id: "d-1", name: "我的手機", region: "sg", dns_filter: "none", status: "active", created_on: "2026-10-27", expires_on: "2030-01-01", used_bytes: 0, blocked: 0, connected: true, moved_until: null, ipv6: true, relay: null, inspection: "active" }]);
      return json({});
    });
    await page.addInitScript((k) => localStorage.setItem("vessel-inspection:d-1", JSON.stringify({ key: k })), KEY);
    await page.goto(path);
    await expect(page.getByTestId("inspect-report")).toBeVisible();
    return asked;
  };
  // the notes in the rows, the table's copies left out
  const rowNotes = (page: Page) => page.getByTestId("inspect-hit").getByTestId("inspect-hit-note");
  const row = (page: Page, name: string) => page.getByTestId("inspect-hit").filter({ has: page.locator("code", { hasText: new RegExp(`^${name.replace(/\./g, "\\.")}$`) }) });

  test("a site with a note says in one short line what it is, its operator and its sources, under what the lists say", async ({ page }) => {
    await open(page, running(NOTES_REPORT));
    const magsrv = row(page, "magsrv.com");
    await expect(magsrv.getByTestId("inspect-hit-note")).toHaveText("廣告聯播網 ExoClick · 來源：docs.exoclick.com");
    await expect(magsrv.getByTestId("inspect-note-text")).toHaveText("廣告聯播網 ExoClick");
    await expect(magsrv.getByTestId("inspect-note-sources")).toHaveText("來源：docs.exoclick.com");
    // the category's sentence is not on the row
    await expect(magsrv).not.toContainText("替許多網站投放廣告");
    const link = magsrv.getByRole("link", { name: "docs.exoclick.com" });
    await expect(link).toHaveAttribute("href", "https://docs.exoclick.com/docs/adblock-dynamic-domains-api");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener");
    // after the lists, as its last line
    const order = await magsrv.locator(".hit-row__words > span").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    expect(order).toEqual(["inspect-hit-words", "inspect-hit-lists", "inspect-hit-note"]);
    // two sources
    await expect(row(page, "diffusedpassionquaking.com").getByTestId("inspect-note-text")).toHaveText("廣告聯播網 Clickadu");
    await expect(row(page, "diffusedpassionquaking.com").getByTestId("inspect-note-sources")).toHaveText("來源：website.informer.com、hypestat.com");
    // without an operator: the category alone. The fourth site of its kind is folded away at first
    await page.getByTestId("inspect-hits-more").first().locator("summary").click();
    await expect(row(page, "opoxv.com").getByTestId("inspect-hit-note")).toHaveText("廣告轉址 · 來源：urlscan.io");
    await expect(row(page, "opoxv.com").getByRole("link", { name: "urlscan.io" })).toHaveAttribute("href", "https://urlscan.io/result/019af467-48a7-727f-b44c-e0afbd5d86e8/");
  });

  test("a name below a noted domain has its note; a name that only ends the same way, or another site, has none", async ({ page }) => {
    await open(page, running(NOTES_REPORT));
    await expect(row(page, "s10.snaptrckr.fun").getByTestId("inspect-note-text")).toHaveText("廣告轉址");
    await expect(row(page, "s10.snaptrckr.fun").getByRole("link", { name: "malwarebytes.com" })).toHaveAttribute("href", "https://www.malwarebytes.com/blog/detections/snaptrckr-fun");
    await expect(row(page, "notmagsrv.com").getByTestId("inspect-hit-note")).toHaveCount(0);
    await expect(row(page, "pixel.example").getByTestId("inspect-hit-note")).toHaveCount(0);
    await expect(rowNotes(page)).toHaveCount(4);
  });

  test("the notes are matched in the browser: no request names a site of the report", async ({ page }) => {
    const asked = await open(page, running(NOTES_REPORT));
    await expect(rowNotes(page)).toHaveCount(4);
    for (const name of [...NOTED, "snaptrckr", "notmagsrv", "pixel.example"]) expect(asked.filter((u) => u.includes(name)), name).toEqual([]);
    // the page's own files, its images, and the three calls any report page makes: no call carries a site to look up
    expect(asked.filter((u) => !u.startsWith("http://127.0.0.1:4174/") && !u.startsWith("https://assets.anoni.net/vessel/"))).toEqual([]);
    const calls = asked.filter((u) => u.includes("/api/")).map((u) => new URL(u).pathname + new URL(u).search);
    expect([...new Set(calls)].sort()).toEqual(["/api/devices", "/api/devices/d-1/inspection", "/api/me"]);
  });

  test("the notes say who wrote them up, with a link to all of them on the lists page", async ({ page }) => {
    await open(page, running(NOTES_REPORT));
    const by = page.getByTestId("inspect-notes-by");
    await expect(by).toHaveText("網站的說明由 anoni.net 整理，整份資料與來源列在網域過濾的名單頁。");
    await expect(by).toHaveCount(1);
    const link = by.getByRole("link", { name: "網域過濾的名單頁" });
    await expect(link).toHaveAttribute("href", "/dns/lists/#site-notes");
    await page.route("**/api/blocklist/lists", (route) => route.fulfill({ status: 503, json: { error: "lists_loading" } }));
    await link.click();
    await expect(page).toHaveURL(/\/dns\/lists\/#site-notes$/);
    await expect(page.getByRole("heading", { name: "檢測報告的網站說明" })).toBeInViewport();
  });

  test("a report without a noted site says nothing about notes", async ({ page }) => {
    await open(page, running(AD_NETWORK_UNNOTED));
    await expect(page.getByTestId("inspect-hit")).toHaveCount(4);
    await expect(page.getByTestId("inspect-hit-note")).toHaveCount(0);
    await expect(page.getByTestId("inspect-notes-by")).toHaveCount(0);
  });

  test("every site an ad network's: the report still needs a check, exactly as without the notes", async ({ page }) => {
    // what the report says without any note: the same report, names no note has
    const read = async () => ({
      state: await page.getByTestId("inspect-verdict").getAttribute("data-state"),
      heading: await page.getByTestId("inspect-verdict").getByRole("heading", { level: 2 }).textContent(),
      icon: await page.locator(".inspect-verdict__state .icon").getAttribute("class"),
      reason: await page.getByTestId("inspect-reason").textContent(),
      severities: await page.getByTestId("inspect-severity").allTextContents(),
      kinds: await page.getByTestId("inspect-kind").evaluateAll((els) => els.map((e) => e.className)),
      rows: await page.getByTestId("inspect-hit").evaluateAll((els) => els.map((e) => e.closest(".inspect-kind")!.className)),
      checks: await page.getByTestId("inspect-check").evaluateAll((els) => els.map((e) => e.getAttribute("data-state"))),
      tiles: await page.locator(".tile--check, .tile--threat").count(),
      steps: await page.getByRole("heading", { name: "接下來可以做" }).count(),
    });
    await open(page, running(AD_NETWORK_UNNOTED));
    const without = await read();
    await page.unrouteAll();
    await open(page, running(AD_NETWORK_REPORT));
    await expect(rowNotes(page)).toHaveCount(4);
    for (const note of await rowNotes(page).all()) await expect(note).toHaveAttribute("data-category", "ad-network");
    const withNotes = await read();
    expect(withNotes).toEqual(without);
    expect(withNotes.state).toBe("check");
    expect(withNotes.heading).toBe("需要檢查");
  });

  test("each category's sentence is said once, under the kind its sites are in, and only the categories seen there", async ({ page }) => {
    await open(page, running(NOTES_REPORT));
    const kinds = page.getByTestId("inspect-kind");
    const notes = kinds.filter({ hasText: "惡意網站名單" }).getByTestId("inspect-kind-notes");
    await expect(notes.locator("p")).toHaveText("這一類裡出現的網站：");
    // two sites of each category, a sentence each; in the order of the file
    await expect(notes.locator("li")).toHaveText([AD, REDIRECT]);
    await expect(page.getByText(AD, { exact: true })).toHaveCount(1);
    // the other kind has no noted site, and says nothing
    await expect(kinds.filter({ hasText: "資安威脅情報名單" }).getByTestId("inspect-kind-notes")).toHaveCount(0);
    await expect(page.getByTestId("inspect-kind-notes")).toHaveCount(1);
    // one category only: one sentence
    await page.unrouteAll();
    await open(page, running(AD_NETWORK_REPORT));
    await expect(page.getByTestId("inspect-kind-notes").locator("li")).toHaveText([AD]);
  });

  test("the table has the notes too", async ({ page }) => {
    await open(page, running(NOTES_REPORT));
    const table = page.getByTestId("inspect-hits-table");
    await table.locator("xpath=ancestor::details[1]/summary").click();
    // on the row under the site's own
    const cell = table.locator("tr", { has: page.locator("code", { hasText: /^magsrv\.com$/ }) }).locator("+ tr.inspect-table__noterow td");
    await expect(cell).toHaveText("廣告聯播網 ExoClick · 來源：docs.exoclick.com");
    await expect(cell.getByRole("link", { name: "docs.exoclick.com" })).toHaveAttribute("target", "_blank");
    await expect(table.getByTestId("inspect-hit-note")).toHaveCount(4);
  });

  test("the downloaded report has the notes, their sources, and a link to the lists page that works from the file", async ({ page }) => {
    await open(page, ended(NOTES_REPORT));
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("inspect-download").click()]);
    const chunks: Buffer[] = [];
    for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
    const html = Buffer.concat(chunks).toString();
    // the sentences once, under the kind
    expect(html.split(AD)).toHaveLength(2);
    expect(html.split(REDIRECT)).toHaveLength(2);
    expect(html).toContain("廣告聯播網 ExoClick");
    expect(html).toContain('href="https://docs.exoclick.com/docs/adblock-dynamic-domains-api" target="_blank" rel="noopener"');
    // in the rows and in the table
    expect(html.match(/data-testid="inspect-hit-note"/g)).toHaveLength(8);
    expect(html).toContain('href="http://127.0.0.1:4174/dns/lists/#site-notes"');
    expect(html).not.toMatch(/href="\/[^/]/);
  });

  test("in English and in Simplified Chinese", async ({ page }) => {
    await open(page, running(NOTES_REPORT), "/en/devices/inspect/?d=d-1");
    await expect(row(page, "magsrv.com").getByTestId("inspect-hit-note")).toHaveText("Ad network run by ExoClick · Source: docs.exoclick.com");
    await expect(page.getByTestId("inspect-kind-notes").locator("li").first()).toHaveText(/^Ad network: A service that places ads on many websites/);
    await expect(row(page, "magsrv.com").getByTestId("inspect-note-sources")).toHaveText("Source: docs.exoclick.com");
    await expect(row(page, "diffusedpassionquaking.com").getByTestId("inspect-note-sources")).toHaveText("Sources: website.informer.com, hypestat.com");
    await expect(page.getByTestId("inspect-notes-by").getByRole("link")).toHaveAttribute("href", "/en/dns/lists/#site-notes");
    await page.goto("/zh-cn/devices/inspect/?d=d-1");
    await page.getByTestId("inspect-hits-more").first().locator("summary").click();
    await expect(row(page, "opoxv.com").getByTestId("inspect-hit-note")).toHaveText("广告跳转 · 来源：urlscan.io");
    await expect(page.getByTestId("inspect-notes-by").getByRole("link")).toHaveAttribute("href", "/zh-cn/dns/lists/#site-notes");
  });
});

// The lists page: all the notes in the open
test.describe("on the lists page", () => {
  const go = async (page: Page, path = "/dns/lists/") => {
    await page.route("**/api/blocklist/lists", (route) => route.fulfill({ status: 503, json: { error: "lists_loading" } }));
    await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
    await page.goto(path);
  };

  test("every category and every site, with what the notes are for and how to report a mistake", async ({ page }) => {
    await go(page);
    const section = page.getByTestId("lists-notes");
    await expect(section.getByRole("heading", { level: 2 })).toHaveText("檢測報告的網站說明");
    await expect(section).toContainText("比對在你的瀏覽器裡進行，報告命中了哪些網站不會送到伺服器");
    await expect(section).toContainText("報告的判斷維持原狀");
    const categories = page.getByTestId("lists-notes-categories").locator("dt");
    await expect(categories).toHaveText(["廣告聯播網", "廣告轉址", "追蹤服務", "釣魚網站", "控制伺服器", "跟蹤軟體廠商"]);
    const table = page.getByTestId("lists-notes-table");
    await expect(table.getByRole("columnheader")).toHaveText(["網域", "類別", "營運者", "來源", "審查日期"]);
    const rows = table.locator("tbody tr");
    await expect(rows.locator("td:first-child code")).toHaveText(["diffusedpassionquaking.com", "magsrv.com", "opoxv.com", "snaptrckr.fun"]);
    await expect(rows.nth(1).locator("td")).toHaveText(["magsrv.com", "廣告聯播網", "ExoClick", "docs.exoclick.com", "2026-11-10"]);
    await expect(rows.nth(2).locator("td")).toHaveText(["opoxv.com", "廣告轉址", "不明", "urlscan.io", "2026-11-10"]);
    await expect(rows.nth(0).getByRole("link")).toHaveText(["website.informer.com", "hypestat.com"]);
    for (const link of await table.getByRole("link").all()) {
      await expect(link).toHaveAttribute("href", /^https:\/\//);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener");
    }
    // as many links as sources in the file
    await expect(table.getByRole("link")).toHaveCount(DATA.sites.reduce((n: number, s: { sources: string[] }) => n + s.sources.length, 0));
    await expect(page.getByTestId("lists-notes-report").getByRole("link", { name: "意見回覆" })).toHaveAttribute("href", "/feedback/");
  });

  test("the section can be reached by its anchor, and is in every language", async ({ page }) => {
    await go(page, "/dns/lists/#site-notes");
    await expect(page.getByRole("heading", { name: "檢測報告的網站說明" })).toBeInViewport();
    await go(page, "/en/dns/lists/");
    await expect(page.getByTestId("lists-notes").getByRole("heading", { level: 2 })).toHaveText("Notes on sites in inspection reports");
    await expect(page.getByTestId("lists-notes-table").locator("tbody tr").nth(1).locator("td")).toHaveText(["magsrv.com", "Ad network", "ExoClick", "docs.exoclick.com", "2026-11-10"]);
    await go(page, "/zh-cn/dns/lists/");
    await expect(page.getByTestId("lists-notes-categories").locator("dt").first()).toHaveText("广告联播网");
  });

  test("the change log has a line for the notes", async ({ page }) => {
    await go(page);
    await page.getByTestId("lists-more").locator("summary").click();
    await expect(page.getByTestId("lists-log").locator("li").first()).toHaveText("2026-11-10 新增檢測報告的網站說明，第一批 4 筆：2 個廣告聯播網與 2 個廣告轉址網域");
  });

  test("the table stays a table on a phone, and nothing runs off the page", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await go(page);
    await expect(page.getByTestId("lists-notes-table").getByRole("columnheader")).toHaveCount(5);
    await expect(page.getByTestId("lists-notes-table").getByRole("cell")).toHaveCount(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
