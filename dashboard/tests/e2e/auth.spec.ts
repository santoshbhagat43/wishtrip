import { ADMIN } from "../utils/env";
import { expect, test } from "../fixtures/test";

test.describe("Authentication", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signed-out visitors are sent to the login page", async ({ page }) => {
    await page.goto("/locations");
    await expect(page).toHaveURL(/\/login\?next=%2Flocations/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    // Staff accounts are created by an admin; the page must not offer a public sign-up.
    await expect(page.getByText(/no public sign-up/)).toBeVisible();
  });

  test("a wrong password shows an error and stays on login", async ({ page, apiLog: _ }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("traveler accounts cannot use the dashboard", async ({ page }) => {
    const email = process.env.DEMO_TRAVELER_EMAIL;
    const password = process.env.DEMO_TRAVELER_PASSWORD;
    test.skip(!email || !password, "DEMO_TRAVELER_* not set in .env");
    await page.goto("/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/for WishTrip staff/)).toBeVisible();
  });

  test("admin can sign in, land on the next page, and sign out", async ({ page, apiLog: _ }) => {
    await page.goto("/tags");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Tags" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
