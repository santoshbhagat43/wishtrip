import { expect, test as setup } from "@playwright/test";

import { ADMIN, SSO_URL } from "../utils/env";

/**
 * Sign in the way staff actually do: the dashboard sends a signed-out visitor to the SSO app,
 * which mints the shared session cookie and sends them back. The saved state holds that cookie
 * (scoped to the parent domain), so every dashboard test starts signed in.
 */
setup("sign in as admin through SSO and save the session", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`^${SSO_URL}/sso/login`));
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The first page of the run: the dev server may still be compiling it, so allow a cold start.
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible({ timeout: 60_000 });
  await page.context().storageState({ path: "playwright/.auth/admin.json" });
});
