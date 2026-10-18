import { test as base, expect, type Page } from "@playwright/test";

/** The shared sign-in app. Signing in happens there, never on the website itself. */
export const SSO_URL = process.env.SSO_URL ?? "http://sso.lvh.me:3001";
export const API_URL = process.env.API_URL ?? "http://localhost:8000";

type Fixtures = { sameOrigin: { calls: string[] } };

/**
 * Every test watches the browser's network: the site must only ever talk to its own origin.
 * The one exception is the SSO app, which the browser is sent to for signing in.
 * Calls are printed live so you can watch the API traffic next to the browser.
 */
export const test = base.extend<Fixtures>({
  sameOrigin: [
    async ({ page, baseURL }, use) => {
      const site = new URL(baseURL!).origin;
      const sso = new URL(SSO_URL).origin;
      const calls: string[] = [];
      const foreign: string[] = [];
      page.on("request", (req) => {
        const url = new URL(req.url());
        if (
          url.protocol.startsWith("http") &&
          url.origin !== site &&
          url.origin !== sso &&
          !url.hostname.endsWith("gstatic.com")
        ) {
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

/** Fill in the SSO login the browser has been sent to; it returns the visitor where they were. */
export async function signInOnSso(page: Page, email: string, password: string) {
  await expect(page).toHaveURL(new RegExp(`^${SSO_URL}/sso/login`));
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Fill in the SSO page's "Create account" form the browser has been sent to. */
export async function createAccountOnSso(page: Page, email: string, password = "e2e-password-123") {
  await expect(page).toHaveURL(new RegExp(`^${SSO_URL}/sso/login`));
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Your name").fill("E2E Traveler");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).last().click();
}

/**
 * A brand-new traveller, signed up through the real SSO "Create account" form, landing back on
 * the profile — where a new traveller starts.
 */
export async function signUp(page: Page) {
  const email = `e2e-site-${Date.now()}@example.com`;
  await page.goto("/profile");
  await createAccountOnSso(page, email);
  await expect(page.getByRole("heading", { name: "How you travel" })).toBeVisible({ timeout: 30_000 });
  return email;
}
