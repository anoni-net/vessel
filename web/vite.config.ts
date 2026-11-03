import { execSync } from "node:child_process";
import { defineConfig } from "vite";

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

// The same policy nginx sends (deploy/nginx/vessel.anoni.net.conf). The preview server sends it too, so the
// Playwright tests run under it; the dev server does not, since its hot reload needs inline scripts.
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://assets.anoni.net/vessel/; connect-src 'self' https://aa.anoni.net/api/send https://vessel-dns-0.anoni.net https://vessel-dns-1.anoni.net https://vessel-dns-2.anoni.net https://vessel-dns-3.anoni.net https://form.anoni.net/api/v1/client/cmc9borto0008lj014bq33jqq/responses; manifest-src 'self'; font-src 'self'; " +
  "form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

// The portal is served from the root of vessel.anoni.net; nginx sends /api/ to the backend.
// During development the backend runs on 127.0.0.1:8090.
export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic", importSource: "preact" },
  },
  server: {
    proxy: { "/api/": "http://127.0.0.1:8090" },
  },
  preview: {
    headers: { "Content-Security-Policy": CSP },
    // tests/analytics.spec.ts reaches the preview as vessel.anoni.net
    allowedHosts: ["vessel.anoni.net"],
  },
  define: {
    __REV__: JSON.stringify(commit()),
    // the day of the build, in UTC
    __BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
