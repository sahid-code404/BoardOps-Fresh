import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/runtime-e2e",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "line" : "html",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm db:reset:local && pnpm dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium-runtime", use: { ...devices["Desktop Chrome"] } },
  ],
});
