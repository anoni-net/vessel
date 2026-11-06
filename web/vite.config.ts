import { execSync } from "node:child_process";
import { type Plugin, defineConfig } from "vite";
import { FEEDBACK_ENDPOINT_ONION } from "./src/feedback.ts";

// The commit the pages are built from, for the footer's REV cell and the feedback form. deploy.sh passes it, since
// its build container has no git; elsewhere ask git. Without either the cell says "dev".
function commit() {
  const passed = process.env.VESSEL_REV ?? "";
  if (/^[0-9a-f]{40}$/.test(passed)) return passed;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

// The onion build (VESSEL_TARGET=onion, src/site.ts) goes to dist-onion/ for vessel.<onion>.
const ONION = process.env.VESSEL_TARGET === "onion";

// The same policy nginx sends (deploy/nginx/vessel.anoni.net.conf, and vessel-onion.conf for the onion build). The
// preview server sends it too, so the Playwright tests run under it; the dev server does not, since its hot reload
// needs inline scripts. The onion build connects only to itself and the form server's onion address.
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://assets.anoni.net/vessel/; connect-src 'self' https://aa.anoni.net/api/send https://vessel-dns-0.anoni.net https://vessel-dns-1.anoni.net https://vessel-dns-2.anoni.net https://vessel-dns-3.anoni.net https://form.anoni.net/api/v1/client/cmc9borto0008lj014bq33jqq/responses; manifest-src 'self'; font-src 'self'; " +
  "form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
export const CSP_ONION =
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' ${FEEDBACK_ENDPOINT_ONION}; manifest-src 'self'; font-src 'self'; ` +
  "form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

// index.html names the favicon on assets.anoni.net; the onion site serves the same file itself (src/images.ts)
function onionHtml(): Plugin {
  return {
    name: "vessel-onion-html",
    transformIndexHtml: (html) => html.replace("https://assets.anoni.net/vessel/", "/vessel-assets/"),
  };
}

// The portal is served from the root of vessel.anoni.net; nginx sends /api/ to the backend.
// During development the backend runs on 127.0.0.1:8090.
export default defineConfig(({ isSsrBuild }) => ({
  oxc: {
    jsx: { runtime: "automatic", importSource: "preact" },
  },
  server: {
    proxy: { "/api/": "http://127.0.0.1:8090" },
  },
  plugins: ONION ? [onionHtml()] : [],
  preview: {
    headers: { "Content-Security-Policy": ONION ? CSP_ONION : CSP },
    // tests/analytics.spec.ts reaches the preview as vessel.anoni.net
    allowedHosts: ["vessel.anoni.net"],
  },
  define: {
    __REV__: JSON.stringify(commit()),
    // the day of the build, in UTC
    __BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __VESSEL_ONION__: JSON.stringify(ONION),
  },
  build: {
    target: "es2022",
    // the SSR build of src/prerender.tsx, which scripts/prerender.mjs runs to write the pages
    outDir: (ONION ? "dist-onion" : "dist") + (isSsrBuild ? "-ssr" : ""),
    sourcemap: false,
  },
}));
