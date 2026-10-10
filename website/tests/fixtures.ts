import { test as base, expect, type Page } from "@playwright/test";

type Fixtures = { sameOrigin: { calls: string[] } };

/**
 * Every test watches the browser's network: the site must only ever talk to its own origin.
 * Calls are printed live so you can watch the API traffic next to the browser.
 */
export const test = base.extend<Fixtures>({
  sameOrigin: [
    async ({ page, baseURL }, use) => {
      const site = new URL(baseURL!).origin;
      const calls: string[] = [];
      const foreign: string[] = [];
      page.on("request", (req) => {
        const url = new URL(req.url());
        if (url.protocol.startsWith("http") && url.origin !== site && !url.hostname.endsWith("gstatic.com")) {
          foreign.push(req.url());
        }
      });
      page.on("response", (res) => {
        const url = new URL(res.url());
        if (url.origin === site && url.pathname.startsWith("/api/")) {
          const line = `${res.request().method().padEnd(6)} ${url.pathname}${url.search}  ${res.status()}`;
          calls.push(line);
          console.log(`    → ${line}`);
        }
      });
      await use({ calls });
      expect(foreign, "browser must never call the backend (or any other origin) directly").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function signUp(page: Page) {
  const email = `e2e-site-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("E2E Traveler");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "How you travel" })).toBeVisible();
  return email;
}
