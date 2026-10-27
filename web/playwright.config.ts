import { defineConfig, devices } from "@playwright/test";

// The backend is mocked per test with page.route, so only the built frontend is served.
export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:4174" },
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
