/** The signed-in traveller's account menu: profile, bookings and the way to sign out. */
import { expect, signUp, test } from "./fixtures";

test("the account menu shows the traveller's links and signs them out", async ({ page }) => {
  const email = await signUp(page);
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(email.split("@")[0], "i") }).click();
  const menu = page.getByRole("menu", { name: "Account" });
  await expect(menu.getByText(email)).toBeVisible();
  for (const label of ["My profile", "My bookings", "Saved", "Plan with Arya", "Help"]) {
    await expect(menu.getByRole("menuitem", { name: new RegExp(label) })).toBeVisible();
  }
  await menu.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await page.goto("/arya");
  await expect(page).toHaveURL(/sso|login/);
});
