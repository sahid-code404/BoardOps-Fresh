import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: process.env.CI ? "line" : "html",
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev:visual",
    url: "http://127.0.0.1:5174",
    // Visual tests must always run against the deterministic fixture app.
    // Reusing the normal runtime server on :5173 causes misleading mass
    // failures when pnpm dev is still running in another terminal.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
