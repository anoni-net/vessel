import { defineConfig } from "vite";

// The portal is served from the root of vessel.anoni.net; nginx sends /api/ to the backend.
// During development the backend runs on 127.0.0.1:8090.
export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic", importSource: "preact" },
  },
  server: {
    proxy: { "/api/": "http://127.0.0.1:8090" },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
