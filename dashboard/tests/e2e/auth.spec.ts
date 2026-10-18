import { ADMIN, DASHBOARD_URL, SSO_URL } from "../utils/env";
import { expect, test } from "../fixtures/test";

const SSO_LOGIN = new RegExp(`^${SSO_URL}/sso/login`);

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await expect(page).toHaveURL(SSO_LOGIN);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("Authentication (SSO)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signed-out visitors are sent to SSO, with the page they wanted as the way back", async ({ page }) => {
    await page.goto("/locations");
    await expect(page).toHaveURL(SSO_LOGIN);
    const back = new URL(page.url()).searchParams.get("redirect");
    expect(back).toBe(`${DASHBOARD_URL}/locations`);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });

  test("a wrong password shows an error and stays on the SSO login", async ({ page, apiLog: _ }) => {
    await page.goto("/");
    await signIn(page, ADMIN.email, "not-the-password");
    await expect(page.getByText("Invalid email or password")).toBeVisible();
    await expect(page).toHaveURL(SSO_LOGIN);
  });

  test("a traveller's session is valid but cannot use the dashboard", async ({ page }) => {
    const email = process.env.DEMO_TRAVELER_EMAIL;
    const password = process.env.DEMO_TRAVELER_PASSWORD;
    test.skip(!email || !password, "DEMO_TRAVELER_* not set in .env");
    await page.goto("/");
    await signIn(page, email!, password!);
    // Shown in place, not redirected — a redirect to SSO would loop for a signed-in traveller.
    await expect(page.getByRole("heading", { level: 1, name: "Staff only" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`^${DASHBOARD_URL}/`));
  });

  test("admin lands on the page they asked for, and sign-out ends the shared session", async ({ page, apiLog: _ }) => {
    await page.goto("/tags");
    await signIn(page, ADMIN.email, ADMIN.password);
    await expect(page.getByRole("heading", { level: 1, name: "Tags" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(SSO_LOGIN);
    // Signed out everywhere: the dashboard sends us straight back to SSO.
    await page.goto("/tags");
    await expect(page).toHaveURL(SSO_LOGIN);
  });

  test("the SSO host serves only the login, never dashboard pages", async ({ page }) => {
    await page.goto(`${SSO_URL}/tags`);
    await expect(page).toHaveURL(new RegExp(`^${SSO_URL}/sso/login`));
  });

  test.describe("before the page has hydrated", () => {
    // Same as a fast submit or a password manager pressing Enter before the script loads.
    test.use({ javaScriptEnabled: false });

    test("sign-in still works, and the password never appears in a URL", async ({ page, context }) => {
      const visited: string[] = [];
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) visited.push(frame.url());
      });
      await page.goto("/tags");
      await signIn(page, ADMIN.email, ADMIN.password);
      await expect(page).toHaveURL(`${DASHBOARD_URL}/tags`);
      expect(visited.filter((u) => u.includes("password"))).toEqual([]);
      const cookies = await context.cookies(DASHBOARD_URL);
      expect(cookies.map((c) => c.name)).toContain("wt_refresh");
    });

    test("a wrong password comes back as a message, not as credentials in the URL", async ({ page }) => {
      await page.goto("/");
      await signIn(page, ADMIN.email, "not-the-password");
      await expect(page).toHaveURL(SSO_LOGIN);
      expect(page.url()).toContain("error=invalid");
      expect(page.url()).not.toContain("password");
      expect(new URL(page.url()).searchParams.get("redirect")).toBe(`${DASHBOARD_URL}/`);
    });
  });

  test("a redirect to a foreign site is refused after sign-in", async ({ page, context }) => {
    const evil = "https://evil.example.com/steal";
    await page.goto(`${SSO_URL}/sso/login?redirect=${encodeURIComponent(evil)}`);
    await signIn(page, ADMIN.email, ADMIN.password);
    // The login page itself carries the evil URL in its query, so wait for the navigation away.
    await expect(page).not.toHaveURL(/evil\.example\.com/);
    expect(new URL(page.url()).hostname).toMatch(/\.lvh\.me$/);
    // And the sign-in really happened — the refusal isn't just a failed login.
    expect((await context.cookies(DASHBOARD_URL)).map((c) => c.name)).toContain("wt_refresh");
  });
});
