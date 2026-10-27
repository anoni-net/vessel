// After `vite build` and the SSR build of src/prerender.tsx: write every page's HTML with its own <head> and
// content, so search engines and link previews see more than an empty <div>. Also writes 404.html,
// robots.txt and sitemap.xml. nginx serves these files and answers other paths with 404.html (deploy/nginx/).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(web, "dist");
const ssr = await import(join(web, "dist-ssr", "prerender.js"));
const { HTML_LANG, LOCALES, PREFIX, PRIVATE_PAGES, PUBLIC_PAGES, ROUTE_PATHS, SITE, headTags, renderPage, titleOf, urlOf } = ssr;

// a page the app has but seo.ts does not list would not be prerendered, and nginx would answer it with 404
const listed = new Set([...PUBLIC_PAGES, ...PRIVATE_PAGES]);
const missing = ROUTE_PATHS.filter((p) => !listed.has(p));
const extra = [...listed].filter((p) => !ROUTE_PATHS.includes(p));
if (missing.length || extra.length) {
  throw new Error(`src/seo.ts and the app's routes differ: missing ${missing.join(", ") || "none"}, extra ${extra.join(", ") || "none"}`);
}

const template = await readFile(join(dist, "index.html"), "utf8");
for (const needle of ['<html lang="zh-Hant-TW">', "<title>Vessel</title>", '<div id="app"></div>']) {
  if (!template.includes(needle)) throw new Error(`index.html no longer has ${needle}`);
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// data-path tells src/main.tsx which page this HTML is, so it reuses the HTML only on that page
function page(locale, title, head, body, path) {
  return template
    .replace('<html lang="zh-Hant-TW">', `<html lang="${HTML_LANG[locale]}">`)
    .replace("<title>Vessel</title>", `<title>${esc(title)}</title>\n${head}`)
    .replace('<div id="app"></div>', `<div id="app" data-path="${path}">${body}</div>`);
}

async function write(file, text) {
  await mkdir(dirname(join(dist, file)), { recursive: true });
  await writeFile(join(dist, file), text);
}

let count = 0;
for (const locale of LOCALES) {
  for (const path of [...PUBLIC_PAGES, ...PRIVATE_PAGES]) {
    const body = await renderPage(locale, path);
    await write(`${PREFIX[locale]}${path}index.html`.replace(/^\//, ""), page(locale, titleOf(locale, path), headTags(locale, path), body, PREFIX[locale] + path));
    count++;
  }
}

// one 404 page; the app reads the real path when it starts and switches to the right language
const notFound = await renderPage("zh-TW", "/404/");
await write("404.html", page("zh-TW", "找不到這一頁 · Vessel", headTags("zh-TW", null), notFound, ""));

await write("robots.txt", ["User-agent: *", "Disallow: /api/", "Disallow: /internal/", "", `Sitemap: ${SITE}/sitemap.xml`, ""].join("\n"));

const entries = PUBLIC_PAGES.flatMap((path) => LOCALES.map((locale) => [
  "  <url>",
  `    <loc>${urlOf(locale, path)}</loc>`,
  ...LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${HTML_LANG[l]}" href="${urlOf(l, path)}"/>`),
  `    <xhtml:link rel="alternate" hreflang="x-default" href="${urlOf("zh-TW", path)}"/>`,
  "  </url>",
].join("\n")));
await write("sitemap.xml", [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ...entries,
  "</urlset>",
  "",
].join("\n"));

console.log(`prerendered ${count} pages, 404.html, robots.txt and sitemap.xml`);
