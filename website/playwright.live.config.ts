import { defineConfig } from "@playwright/test";

/**
 * Checks against the DEPLOYED server's API, not the local stack: is what we show really what
 * TripJack returned, and how fast is it?
 *
 *   LIVE_TOKEN=<staff access token> pnpm exec playwright test -c playwright.live.config.ts
 *
 * LIVE_API_URL defaults to https://wishtrip-api.listnr.co. The token is a short-lived (30 minute)
 * staff token; see tests/live/README.md for how to get one without a password.
 */
export default defineConfig({
  testDir: "./tests/live",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000, // a fresh flight search takes TripJack up to 20 seconds
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-live" }]],
  use: {
    baseURL: process.env.LIVE_API_URL ?? "https://wishtrip-api.listnr.co",
    extraHTTPHeaders: process.env.LIVE_TOKEN ? { Authorization: `Bearer ${process.env.LIVE_TOKEN}` } : {},
  },
});
