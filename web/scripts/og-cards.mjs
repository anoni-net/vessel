// The share images (1200 × 630, src/seo.ts): the home page's blocks and FIG. 01 in a drawing's frame, one per language,
// taken from the built site so they match it. FIG. 01 changes, run this again: `npm run build && npm run preview`, then
// `node scripts/og-cards.mjs <output directory>`. It prints each file's name with its content hash: upload them to
// assets.anoni.net under vessel/ and change the addresses in src/seo.ts.
import { createHash } from "node:crypto";
import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const SITE = "http://127.0.0.1:4174";
const CARDS = [
  { id: "zh-tw", path: "/", line: "anoni.net 架設的 VPN，連線經過偽裝", by: "匿名網路社群 anoni.net" },
  { id: "zh-cn", path: "/zh-cn/", line: "anoni.net 架设的 VPN，连接经过伪装", by: "匿名网络社区 anoni.net" },
  { id: "en", path: "/en/", line: "A disguised VPN by anoni.net", by: "The anoni.net community" },
];
const STYLE = `
  html, body { width: 1200px; height: 630px; margin: 0; overflow: hidden; }
  body { background-color: var(--page);
    background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px);
    background-size: 24px 24px; }
  .og { position: absolute; inset: 35px; box-sizing: border-box; border: 2px solid var(--ink); background: var(--frame-fill); }
  .og__logo { position: absolute; left: 32px; top: 22px; height: 34px; width: auto; }
  .og__tag { position: absolute; right: 30px; top: 28px; margin: 0; font: 600 12px var(--mono); letter-spacing: .16em; color: var(--muted); }
  .og__title { position: absolute; left: 30px; top: 172px; width: 525px; margin: 0; }
  .og__title .block-title { display: block; width: 100%; height: auto; }
  .og__line { position: absolute; left: 30px; top: 336px; width: 620px; margin: 0; font: 700 34px/1.3 var(--font); color: var(--ink); }
  .og .hero-fig { position: absolute; left: 658px; top: 126px; width: 440px; margin: 0; background: #fff; }
  .og__block { position: absolute; left: 0; right: 0; bottom: 0; height: 66px; display: grid; grid-template-columns: repeat(3, 1fr);
    border-top: 1.5px solid var(--ink); }
  .og__cell { display: flex; flex-direction: column; justify-content: center; gap: 2px; padding-inline: 18px; }
  .og__cell + .og__cell { border-inline-start: 1px solid var(--ink); }
  .og__field { font: 600 11px var(--mono); letter-spacing: .16em; color: var(--muted); }
  .og__value { font: 700 20px/1.25 var(--font); color: var(--text); }
  .og__value--mono { font-family: var(--mono); }
`;

const out = process.argv[2];
if (!out) throw new Error("usage: node scripts/og-cards.mjs <output directory>");
const browser = await chromium.launch();
for (const card of CARDS) {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 }, colorScheme: "light", reducedMotion: "reduce", bypassCSP: true,
  });
  const page = await context.newPage();
  await page.route("**/api/**", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
  await page.goto(SITE + card.path);
  await page.locator(".hero .hero-fig svg").waitFor();
  await page.evaluate(({ card, style }) => {
    const figure = document.querySelector(".hero .hero-fig");
    const title = document.querySelector(".hero__title .block-title");
    const logo = document.querySelector(".site-header img").getAttribute("src");
    const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text ?? "" });
    const frame = el("div", "og");
    const mark = el("img", "og__logo");
    mark.src = logo;
    const heading = el("div", "og__title");
    heading.append(title);
    const block = el("div", "og__block");
    for (const [field, value, mono] of [["PROJECT", "Vessel"], ["BY", card.by], ["URL", "vessel.anoni.net", true]]) {
      const cell = el("div", "og__cell");
      cell.append(el("span", "og__field", field), el("span", `og__value${mono ? " og__value--mono" : ""}`, value));
      block.append(cell);
    }
    frame.append(mark, el("p", "og__tag", "COMMUNITY VPN"), heading, el("p", "og__line", card.line), figure, block);
    document.body.replaceChildren(frame, Object.assign(document.createElement("style"), { textContent: style }));
  }, { card, style: STYLE });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  const file = join(out, `og-${card.id}.png`);
  await page.screenshot({ path: file });
  const hash = createHash("sha256").update(await readFile(file)).digest("hex").slice(0, 8);
  const named = join(out, `og-${card.id}-${hash}.png`);
  await rename(file, named);
  console.log(named);
  await context.close();
}
await browser.close();
