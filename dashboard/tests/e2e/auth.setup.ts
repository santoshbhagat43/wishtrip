import { expect, test as setup } from "@playwright/test";

import { ADMIN } from "../utils/env";

setup("sign in as admin and save the session", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await page.context().storageState({ path: "playwright/.auth/admin.json" });
});
