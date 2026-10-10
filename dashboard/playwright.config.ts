import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

// Credentials and URLs come from the repo's .env (ADMIN_EMAIL / ADMIN_PASSWORD).
const envFile = resolve(__dirname, "../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const headless = process.env.HEADLESS === "1";

export default defineConfig({
  testDir: "./tests",
  // Headed runs are for watching: one browser, one test at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.DASHBOARD_URL ?? "http://localhost:3001",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
  },
  projects: [
    // API tests talk to FastAPI directly and log every request/response.
    {
      name: "api",
      testDir: "./tests/api",
      use: { baseURL: process.env.API_URL ?? "http://localhost:8000" },
    },
    { name: "setup", testDir: "./tests/e2e", testMatch: /auth\.setup\.ts/ },
    {
      name: "dashboard",
      testDir: "./tests/e2e",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "playwright/.auth/admin.json",
        headless,
        launchOptions: { slowMo: headless ? 0 : Number(process.env.SLOW_MO ?? 250) },
      },
    },
  ],
});
