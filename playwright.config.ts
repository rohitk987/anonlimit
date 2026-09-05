import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  outputDir: "test-results/playwright",
  reporter: [["html", { open: "never", outputFolder: "playwright-report" }], ["list"]],
  retries: 0,
  testDir: "tests/e2e",
  timeout: 30000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
