import { expect, test } from "../fixtures/test";

test.describe("Travelers", () => {
  test("recommendation inspector explains the ranking", async ({ page, apiLog: _ }) => {
    await page.goto("/travelers");
    // Wait for either the table or the empty state before deciding.
    await expect(page.locator("tbody tr").first().or(page.getByText("No travelers yet"))).toBeVisible();
    test.skip((await page.locator("tbody tr").count()) === 0, "no travelers seeded");
    await page.locator("tbody tr").first().getByRole("link").click();
    await expect(page.getByText("Recommendation inspector")).toBeVisible();
    await page.getByRole("combobox", { name: "City" }).selectOption({ label: "London — United Kingdom" });
    await expect(page.getByText(/^Score /).first()).toBeVisible();
    await expect(page.getByText(/Weights:/)).toBeVisible();
  });
});

test.describe("Staff users", () => {
  test("invites an editor and disables them", async ({ page, apiLog: _ }) => {
    const email = `e2e-editor-${Date.now()}@example.com`;
    await page.goto("/users");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Full name").fill("E2E Editor");
    await page.getByPlaceholder("Temporary password (8+)").fill("e2e-password-123");
    await page.getByRole("button", { name: "Invite" }).click();
    const row = page.locator("tr").filter({ hasText: email });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Disable" }).click();
    await expect(row.getByText("Disabled")).toBeVisible();
  });
});

test.describe("Audit log", () => {
  test("records knowledge changes and filters by entity", async ({ page, apiLog: _ }) => {
    await page.goto("/audit-log");
    await page.getByLabel("Entity").selectOption("location");
    await expect(page.locator("tbody tr").first()).toContainText("location");
  });
});
