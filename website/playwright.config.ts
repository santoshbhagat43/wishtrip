import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

// Staff credentials (ADMIN_EMAIL / ADMIN_PASSWORD) for tests that also drive the dashboard.
const envFile = resolve(__dirname, "../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const headless = process.env.HEADLESS === "1";

export default defineConfig({
  testDir: "./tests",
  // The live checks against the deployed server have their own config (playwright.live.config.ts).
  testIgnore: "**/live/**",
  fullyParallel: false,
  workers: 1,
  timeout: 240_000, // chat turns run a local LLM
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    ...devices["Desktop Chrome"],
    // A sibling of the SSO host (sso.lvh.me): localhost can't read the shared .lvh.me session.
    baseURL: process.env.WEBSITE_URL ?? "http://app.lvh.me:3002",
    viewport: { width: 1440, height: 900 },
    headless,
    launchOptions: { slowMo: headless ? 0 : Number(process.env.SLOW_MO ?? 200) },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
