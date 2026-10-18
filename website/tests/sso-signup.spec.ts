/**
 * Signing up through the shared SSO app — and keeping the creator who brought the visitor.
 *
 * Sign-up moved from the website to the SSO host (sso.<domain>). A creator's /c/<code> link sets
 * referral cookies on the website; these tests prove the SSO app still sees them, so the creator
 * is credited for the new traveller.
 */
import type { APIRequestContext } from "@playwright/test";

import { API_URL, SSO_URL, createAccountOnSso, expect, test } from "./fixtures";

const ADMIN = { email: process.env.ADMIN_EMAIL ?? "", password: process.env.ADMIN_PASSWORD ?? "" };

async function adminCreators(request: APIRequestContext) {
  const login = await request.post(`${API_URL}/auth/login`, { data: ADMIN });
  expect(login.status(), "admin login (ADMIN_* in ../.env)").toBe(200);
  const { access_token } = await login.json();
  const res = await request.get(`${API_URL}/creators`, { headers: { Authorization: `Bearer ${access_token}` } });
  expect(res.status()).toBe(200);
  return (await res.json()) as {
    referral_code: string;
    status: string;
    stats: { credited_travellers: number };
  }[];
}

test.describe("Sign-up on SSO", () => {
  test("/signup opens the SSO 'Create account' form and returns the new traveller signed in", async ({ page, baseURL }) => {
    await page.goto("/signup");
    await expect(page).toHaveURL(new RegExp(`^${SSO_URL}/sso/login`));
    await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();

    await page.getByLabel("Your name").fill("E2E Traveler");
    await page.getByLabel("Email").fill(`e2e-sso-${Date.now()}@example.com`);
    await page.getByLabel("Password").fill("e2e-password-123");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(`${baseURL}/plan`);
    expect((await page.request.get("/api/wt/auth/me")).status()).toBe(200);
  });

  test("an email that already has an account gets a clear message", async ({ page }) => {
    const email = `e2e-dup-${Date.now()}@example.com`;
    const first = await page.request.post(`${API_URL}/auth/register`, {
      data: { email, password: "e2e-password-123" },
    });
    expect(first.status()).toBe(201);

    await page.goto("/profile");
    await createAccountOnSso(page, email);
    await expect(page.getByText("already registered")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`^${SSO_URL}/sso/login`));
  });

  test("a creator's link is still credited when the visitor signs up on SSO", async ({ page, request, context }) => {
    const creator = (await adminCreators(request)).find((c) => c.status === "active" && c.referral_code);
    test.skip(!creator, "no active creator with a referral code in this database");
    const before = creator!.stats.credited_travellers;

    // The visitor arrives through the creator's link…
    await page.goto(`/c/${creator!.referral_code}`);
    const refCookie = (await context.cookies(SSO_URL)).find((c) => c.name === "wishtrip_ref");
    expect(refCookie?.value, "the referral cookie must reach the SSO host").toBe(creator!.referral_code);

    // …and signs up on the SSO app.
    await page.goto("/profile");
    await createAccountOnSso(page, `e2e-ref-${Date.now()}@example.com`);
    await expect(page.getByRole("heading", { name: "How you travel" })).toBeVisible({ timeout: 30_000 });

    const after = (await adminCreators(request)).find((c) => c.referral_code === creator!.referral_code)!;
    expect(after.stats.credited_travellers).toBe(before + 1);
  });
});
