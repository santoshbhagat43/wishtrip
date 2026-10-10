import { uniqueName } from "../utils/env";
import { expect, test } from "../fixtures/test";

test.describe("Hierarchy", () => {
  test("browses country → region cities → places", async ({ page, apiLog: _ }) => {
    await page.goto("/hierarchy");
    const india = page.getByRole("link", { name: "India", exact: true });
    await india.locator("xpath=..").getByRole("button", { name: "Expand" }).click();
    const munnar = page.getByRole("link", { name: "Munnar tea hills" });
    await expect(munnar).toBeVisible();
    await expect(page.getByText("· Kerala").first()).toBeVisible();
    // The row is the link's parent; expand Munnar itself, not an ancestor row.
    await munnar.locator("xpath=..").getByRole("button", { name: "Expand" }).click();
    await expect(page.getByRole("link", { name: /tea gardens/i })).toBeVisible();
  });
});

test.describe("Tags", () => {
  test("creates and deletes a tag", async ({ page, apiLog: _ }) => {
    const name = uniqueName("Tag");
    await page.goto("/tags");
    await page.getByPlaceholder("New tag name").fill(name);
    await page.getByRole("button", { name: "Add tag" }).click();
    await expect(page.getByRole("link", { name })).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    await expect(page.getByRole("link", { name })).toBeHidden();
  });
});

test.describe("Semantic search", () => {
  test("finds knowledge the way the chat retrieves it", async ({ page, apiLog: _ }) => {
    await page.goto("/search");
    await page.getByPlaceholder("quiet sunset spot for a couple").fill("tea gardens tasting");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Embeddings:/)).toBeVisible();
    await expect(page.getByRole("link", { name: /tea gardens/i }).first()).toBeVisible();
  });
});
