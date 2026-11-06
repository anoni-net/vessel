import { defineConfig, devices } from "@playwright/test";

// The backend is mocked per test with page.route, so only the built frontend is served: the clearnet build on 4174,
// and the onion build (VESSEL_TARGET=onion) on 4175 for tests/onion.spec.ts.
export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  // the pages under test are mostly Traditional Chinese; a browser that prefers it gets no language bar
  use: { baseURL: "http://127.0.0.1:4174", locale: "zh-TW" },
  webServer: [
    {
      command: "npm run build && npm run preview",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm run build:onion && npm run preview:onion",
      url: "http://127.0.0.1:4175",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: "onion.spec.ts" },
    { name: "phone", use: { ...devices["Pixel 7"] }, testIgnore: "onion.spec.ts" },
    { name: "onion", use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4175" }, testMatch: "onion.spec.ts" },
  ],
});
