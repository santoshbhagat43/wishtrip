import { defineConfig, devices } from "@playwright/test";

const headless = process.env.HEADLESS === "1";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 240_000, // chat turns run a local LLM
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.WEBSITE_URL ?? "http://localhost:3002",
    viewport: { width: 1440, height: 900 },
    headless,
    launchOptions: { slowMo: headless ? 0 : Number(process.env.SLOW_MO ?? 200) },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
