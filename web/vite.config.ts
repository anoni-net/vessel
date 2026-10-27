import { defineConfig } from "vite";

// The same policy nginx sends (deploy/nginx/vessel.anoni.net.conf). The preview server sends it too, so the
// Playwright tests run under it; the dev server does not, since its hot reload needs inline scripts.
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' https://aa.anoni.net/api/send; manifest-src 'self'; " +
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
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
