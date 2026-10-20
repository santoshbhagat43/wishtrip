import type { Page } from "@playwright/test";

import { ADMIN, DASHBOARD_URL, SSO_URL } from "../utils/env";
import { expect, test } from "../fixtures/test";

const ADMIN_LOGIN = new RegExp(`^${DASHBOARD_URL}/login`);
const SSO_LOGIN = new RegExp(`^${SSO_URL}/sso/login`);

/** The SSO page's code flow: an email, then the emailed code (locally the opt-in fixed one). */
async function signInWithCode(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Sign-in code").fill(process.env.CREATOR_DEV_OTP ?? "1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function fillAndSubmit(page: Page, email: string, password: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test.describe("Admin dashboard sign-in (its own, not SSO)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signed-out visitors get the admin login, with the page they wanted kept", async ({ page }) => {
    await page.goto("/locations");
    await expect(page).toHaveURL(ADMIN_LOGIN);
    expect(new URL(page.url()).searchParams.get("next")).toBe("/locations");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByText(/no public sign-up/)).toBeVisible();
  });

  test("a wrong password shows an error and stays on the admin login", async ({ page, apiLog: _ }) => {
    await page.goto("/login");
    await fillAndSubmit(page, ADMIN.email, "not-the-password");
    await expect(page.getByText("Invalid email or password")).toBeVisible();
    await expect(page).toHaveURL(ADMIN_LOGIN);
  });

  test("traveller accounts are refused", async ({ page }) => {
    const email = process.env.DEMO_TRAVELER_EMAIL;
    const password = process.env.DEMO_TRAVELER_PASSWORD;
    test.skip(!email || !password, "DEMO_TRAVELER_* not set in .env");
    await page.goto("/login");
    await fillAndSubmit(page, email!, password!);
    await expect(page.getByText(/is for WishTrip staff/)).toBeVisible();
    await expect(page).toHaveURL(ADMIN_LOGIN);
  });

  test("admin lands on the page they asked for, and sign-out ends the session", async ({ page, apiLog: _ }) => {
    await page.goto("/tags");
    await fillAndSubmit(page, ADMIN.email, ADMIN.password);
    await expect(page.getByRole("heading", { level: 1, name: "Tags" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(ADMIN_LOGIN);
    await page.goto("/tags");
    await expect(page).toHaveURL(ADMIN_LOGIN);
  });

  test("an SSO session grants nothing in the admin dashboard", async ({ page, context }) => {
    // Sign in on the shared SSO app (staff can't: a code to an inbox never opens a team account).
    await page.goto(`${SSO_URL}/sso/login`);
    await signInWithCode(page, `e2e-sso-${Date.now()}@example.com`);
    await expect
      .poll(async () => (await context.cookies(SSO_URL)).map((c) => c.name))
      .toContain("wt_refresh");

    // The dashboard ignores that session entirely and asks for its own sign-in.
    await page.goto("/");
    await expect(page).toHaveURL(ADMIN_LOGIN);
  });

  test("after sign-in, a ?next= pointing at another site is not followed", async ({ page }) => {
    await page.goto(`/login?next=${encodeURIComponent("//evil.example.com/steal")}`);
    await fillAndSubmit(page, ADMIN.email, ADMIN.password);
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    expect(page.url()).not.toContain("evil.example.com");
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
      await fillAndSubmit(page, ADMIN.email, ADMIN.password);
      await expect(page).toHaveURL(`${DASHBOARD_URL}/tags`);
      expect(visited.filter((u) => u.includes("password"))).toEqual([]);
      expect((await context.cookies(DASHBOARD_URL)).map((c) => c.name)).toContain("wishtrip_admin_refresh");
    });

    test("a wrong password comes back as a message, not as credentials in the URL", async ({ page }) => {
      await page.goto("/login");
      await fillAndSubmit(page, ADMIN.email, "not-the-password");
      await expect(page).toHaveURL(ADMIN_LOGIN);
      expect(page.url()).toContain("error=invalid");
      expect(page.url()).not.toContain("password");
    });
  });
});

test.describe("SSO app (travellers and creators)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the SSO host serves only the login, never dashboard pages", async ({ page }) => {
    await page.goto(`${SSO_URL}/tags`);
    await expect(page).toHaveURL(SSO_LOGIN);
  });

  test("a redirect to a foreign site is refused after sign-in", async ({ page, context }) => {
    const evil = "https://evil.example.com/steal";
    await page.goto(`${SSO_URL}/sso/login?redirect=${encodeURIComponent(evil)}`);
    await signInWithCode(page, `e2e-evil-${Date.now()}@example.com`);
    // The login page itself carries the evil URL in its query, so wait for the navigation away.
    await expect(page).not.toHaveURL(/evil\.example\.com/);
    expect(new URL(page.url()).hostname).toMatch(/\.lvh\.me$/);
    expect((await context.cookies(SSO_URL)).map((c) => c.name)).toContain("wt_refresh");
  });

  test.describe("before the page has hydrated", () => {
    test.use({ javaScriptEnabled: false });

    test("signing in with a code works as a plain form, and the code never appears in a URL", async ({ page, context }) => {
      await page.goto(`${SSO_URL}/sso/login`);
      await signInWithCode(page, `e2e-nojs-${Date.now()}@example.com`);
      // Without script the forms post natively, and the answer is a redirect, not a URL with secrets.
      await expect(page).not.toHaveURL(SSO_LOGIN);
      expect((await context.cookies(SSO_URL)).map((c) => c.name)).toContain("wt_refresh");
    });

    test("a wrong code comes back as a message, not as the code in the URL", async ({ page }) => {
      await page.goto(`${SSO_URL}/sso/login`);
      await page.getByLabel("Email").fill(`e2e-nojs-bad-${Date.now()}@example.com`);
      await page.getByRole("button", { name: "Send code" }).click();
      await page.getByLabel("Sign-in code").fill("999999");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(SSO_LOGIN);
      expect(page.url()).toContain("error=code_wrong");
      expect(page.url()).not.toContain("999999");
    });
  });
});
