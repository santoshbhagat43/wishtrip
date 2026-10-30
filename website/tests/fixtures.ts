import { test as base, expect, type Page } from "@playwright/test";

/** The shared sign-in app. Signing in happens there, never on the website itself. */
export const SSO_URL = process.env.SSO_URL ?? "http://sso.lvh.me:3001";
export const API_URL = process.env.API_URL ?? "http://localhost:8000";
/** The creator site: the same app as the website, on its own host. */
export const CREATOR_URL = process.env.CREATOR_URL ?? "http://creator.lvh.me:3003";

type Fixtures = { sameOrigin: { calls: string[] } };

/**
 * Every test watches the browser's network: the site must only ever talk to its own origin.
 * The exceptions are the SSO app (where the browser signs in) and the creator site (this same
 * app on its own host).
 * Calls are printed live so you can watch the API traffic next to the browser.
 */
export const test = base.extend<Fixtures>({
  sameOrigin: [
    async ({ page, baseURL }, use) => {
      const site = new URL(baseURL!).origin;
      const allowed = new Set([site, new URL(SSO_URL).origin, new URL(CREATOR_URL).origin]);
      const calls: string[] = [];
      const foreign: string[] = [];
      page.on("request", (req) => {
        const url = new URL(req.url());
        if (
          url.protocol.startsWith("http") &&
          !allowed.has(url.origin) &&
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

/** The local, opt-in fixed sign-in code (CREATOR_DEV_OTP): the app has no hardcoded one. */
export const DEV_CODE = process.env.CREATOR_DEV_OTP ?? "1234";

/**
 * Sign in (or up: the first sign-in makes the account) on the SSO page the browser has been sent
 * to, with an emailed one-time code. There are no passwords for travellers.
 */
export async function signInOnSso(page: Page, email: string) {
  await expect(page).toHaveURL(new RegExp(`^${SSO_URL}/sso/login`));
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Sign-in code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** Same page, same flow: a new email simply gets a new account. */
export const createAccountOnSso = signInOnSso;

/**
 * A brand-new traveller, signed up through the real SSO code form, landing back on
 * the profile — where a new traveller starts.
 */
export async function signUp(page: Page) {
  const email = `e2e-site-${Date.now()}@example.com`;
  await page.goto("/profile");
  await signInOnSso(page, email);
  await expect(page.getByRole("heading", { name: "How you travel" })).toBeVisible({ timeout: 30_000 });
  return email;
}

/** The details a trip board cannot be made without: the day they leave (a month out) and the city
 *  they fly from, filled in on the Details screen the page is on. */
/** The day a test trip leaves (30 days out), plus `n` days, as yyyy-mm-dd. */
export const tripDay = (n = 0) => new Date(Date.now() + (30 + n) * 86_400_000).toISOString().slice(0, 10);

/** The Details screen's dates and from-city. `days` sets the day they come back; without it the
 *  return is what the reel says. */
export async function fillTripDetails(page: Page, from = "Bengaluru (BLR)", days?: number) {
  // The form is on the page twice (phones and desktop): fill the one that is showing.
  await page.getByLabel("Leaving on").filter({ visible: true }).fill(tripDay());
  if (days) await page.getByLabel("Coming back on").filter({ visible: true }).fill(tripDay(days - 1));
  await page.getByLabel("Flying from").filter({ visible: true }).fill(from);
}
