import { expect, test as setup } from "@playwright/test";

import { ADMIN } from "../utils/env";

/**
 * Staff sign in on the admin dashboard's own /login — it is deliberately separate from the SSO
 * used by travellers and creators. The saved state holds the admin session cookie, so every
 * dashboard test starts signed in.
 */
setup("sign in as admin and save the session", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The first page of the run: the dev server may still be compiling it, so allow a cold start.
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible({ timeout: 60_000 });
  await page.context().storageState({ path: "playwright/.auth/admin.json" });
});
