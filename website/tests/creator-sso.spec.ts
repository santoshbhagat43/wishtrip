/**
 * The creator site (creator.<domain>) and creator sign-in through the shared SSO app.
 *
 * Locally no email or WhatsApp provider is configured, so codes use the fixed fallback
 * (CREATOR_DEV_OTP, "1234"). With SMTP set, email codes become real and these flows are the same.
 */
import type { Page } from "@playwright/test";

import { API_URL, CREATOR_URL, SSO_URL, expect, test } from "./fixtures";

const DEV_CODE = process.env.CREATOR_DEV_OTP ?? "1234";
const SSO_LOGIN = new RegExp(`^${SSO_URL}/sso/login`);

async function signInWithCode(page: Page, code: string) {
  await expect(page.getByLabel("Sign-in code")).toBeVisible();
  await page.getByLabel("Sign-in code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("Creator site", () => {
  test("the creator site's front door is the creator programme", async ({ page }) => {
    await page.goto(`${CREATOR_URL}/`);
    await expect(page).toHaveURL(`${CREATOR_URL}/creators`);
  });

  test("on the traveller site, creator portal links move to the creator site", async ({ page }) => {
    await page.goto("/creator");
    // …and, signed out, on to creator sign-in on SSO with the portal as the way back.
    await expect(page).toHaveURL(SSO_LOGIN);
    const url = new URL(page.url());
    expect(url.searchParams.get("for")).toBe("creator");
    expect(url.searchParams.get("redirect")).toBe(`${CREATOR_URL}/creator`);
  });

  test("a creator signs in with an email code and lands in their portal", async ({ page }) => {
    await page.goto(`${CREATOR_URL}/creator`);
    await expect(page).toHaveURL(SSO_LOGIN);
    await expect(page.getByRole("heading", { level: 1, name: "Creator sign-in" })).toBeVisible();

    await page.getByLabel("Email").fill(`e2e-creator-${Date.now()}@creators.example.com`);
    await page.getByRole("button", { name: "Send code" }).click();
    await signInWithCode(page, DEV_CODE);

    await expect(page).toHaveURL(`${CREATOR_URL}/creator`);
    // A first email sign-in makes a pending creator, waiting for staff to approve them.
    await expect(page.getByText("Waiting for approval").first()).toBeVisible();
    // Back to the creator site's front door, they now go straight to the portal.
    await page.goto(`${CREATOR_URL}/`);
    await expect(page).toHaveURL(`${CREATOR_URL}/creator`);
  });

  test("a creator who applied with a WhatsApp number can sign in with a WhatsApp code", async ({ page }) => {
    const local = String(Date.now()).slice(-8);
    const phone = `+9198${local}`;
    const email = `e2e-wa-${Date.now()}@creators.example.com`;
    const applied = await page.request.post(`${API_URL}/creators/apply`, {
      data: { email, name: "E2E WhatsApp Creator", whatsapp: phone },
    });
    expect(applied.status()).toBe(202);

    await page.goto(`${CREATOR_URL}/creator`);
    await page.getByRole("tab", { name: "WhatsApp" }).click();
    await page.getByLabel("WhatsApp number").fill(`98${local}`);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByText(phone)).toBeVisible();
    await signInWithCode(page, DEV_CODE);

    await expect(page).toHaveURL(`${CREATOR_URL}/creator`);
    await expect(page.getByText("Waiting for approval").first()).toBeVisible();
    const me = await (await page.request.get(`${CREATOR_URL}/api/wt/auth/me`)).json();
    expect(me.email).toBe(email);
  });

  test("a wrong code is refused with a clear message", async ({ page }) => {
    await page.goto(`${CREATOR_URL}/creator`);
    await page.getByLabel("Email").fill(`e2e-wrong-${Date.now()}@creators.example.com`);
    await page.getByRole("button", { name: "Send code" }).click();
    await signInWithCode(page, DEV_CODE === "9999" ? "8888" : "9999");
    await expect(page.getByText(/isn.t right, or it has expired/)).toBeVisible();
    await expect(page).toHaveURL(SSO_LOGIN);
  });

  test("a traveller's email can't be used as a creator sign-in", async ({ page }) => {
    const email = `e2e-trav-${Date.now()}@example.com`;
    const reg = await page.request.post(`${API_URL}/auth/register`, { data: { email, password: "e2e-password-123" } });
    expect(reg.status()).toBe(201);

    await page.goto(`${CREATOR_URL}/creator`);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    await signInWithCode(page, DEV_CODE);
    await expect(page.getByText(/already has a traveller account/)).toBeVisible();
  });
});
