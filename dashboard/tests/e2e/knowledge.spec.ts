import { uniqueName } from "../utils/env";
import { expect, test } from "../fixtures/test";

test.describe("Destinations", () => {
  test("country → city → History · Hotels · Experiences · Food & drink", async ({ page, apiLog: _ }) => {
    // The old tree view sends people to the new flow.
    await page.goto("/hierarchy");
    await expect(page).toHaveURL(/\/destinations$/);
    await page.getByRole("link", { name: /^India/ }).click();
    await page.getByRole("link", { name: /^Munnar tea hills/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Munnar tea hills" })).toBeVisible();

    // History: written in place, saved, counted.
    const history = page.getByRole("textbox", { name: "History" });
    const before = await history.inputValue();
    await history.fill(`${before}${before ? " " : ""}E2E line`);
    await page.getByRole("button", { name: "Save history" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await history.fill(before); // put it back
    await page.getByRole("button", { name: "Save history" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    // Each section lists that kind of place and adds one in this city.
    await page.getByRole("tab", { name: /Hotels/ }).click();
    await expect(page.getByRole("link", { name: "Add hotel" })).toHaveAttribute("href", /type=hotel&parent_id=/);
    await page.getByRole("tab", { name: /Experiences/ }).click();
    await expect(page.getByRole("link", { name: /tea gardens/i })).toBeVisible();
    await page.getByRole("tab", { name: /Food & drink/ }).click();
    await expect(page.getByRole("link", { name: "Add place to eat" })).toBeVisible();
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
