import { uniqueName } from "../utils/env";
import { expect, test, watchConsoleErrors } from "../fixtures/test";

// A 1×1 PNG, enough to exercise the upload path.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEhwH/2BKRNgAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Locations list", () => {
  test("filters by type, source and verification, and searches", async ({ locationsPage, page }) => {
    await locationsPage.goto();
    await locationsPage.typeFilter.selectOption("hotel");
    await locationsPage.sourceFilter.selectOption("goexperience-kb");
    await locationsPage.verificationFilter.selectOption("true");
    await expect(page).toHaveURL(/type=hotel/);
    await expect(locationsPage.rows.first()).toContainText(/hotel/i);
    await expect(locationsPage.rows.first().getByText("Verify")).toBeVisible();

    await page.goto("/locations");
    await locationsPage.search.fill("Tower Bridge");
    await expect(locationsPage.row("Tower Bridge")).toBeVisible();
  });
});

test.describe("Location lifecycle", () => {
  test("create, edit every section, relate, upload media, and delete", async ({ page, locationPage }) => {
    const console = watchConsoleErrors(page);
    const name = uniqueName("Rooftop cafe");

    // Create
    await page.goto("/locations/new");
    await locationPage.field("Name").fill(name);
    await locationPage.select("Type").selectOption("restaurant");
    await page.getByPlaceholder("Search city…").fill("London");
    await page.getByRole("button", { name: /^London\b/ }).click();
    await locationPage.field("Summary").fill("Test café with skyline views");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name: "London" })).toBeVisible();

    // Travel info: duration, best time, price stays honest
    await page.getByRole("tab", { name: "Travel info" }).click();
    await locationPage.number("Duration (minutes)").fill("75");
    await page.getByRole("button", { name: "evening", exact: true }).click();
    await locationPage.save();

    // Characteristics
    await page.getByRole("tab", { name: "Characteristics" }).click();
    await locationPage.select("Energy level").selectOption("2");
    await locationPage.save();

    // Knowledge & tags
    await page.getByRole("tab", { name: "Knowledge & tags" }).click();
    await page.getByPlaceholder("Great river views").fill("Skyline views");
    await page.getByRole("button", { name: "Add" }).first().click();
    await page.getByPlaceholder("Filter tags").fill("Scenic");
    await page.getByRole("button", { name: "Scenic views" }).click();
    await locationPage.save();
    await expect(page.getByText("Missing:").first()).not.toContainText("duration");

    // Relationships
    await locationPage.tab("Relationships").click();
    await page.getByPlaceholder("Search locations…").fill("Tower Bridge");
    await page.getByRole("button", { name: /^Tower Bridge/ }).click();
    await page.getByRole("spinbutton", { name: "Travel minutes" }).fill("10");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("link", { name: "Tower Bridge" })).toBeVisible();

    // Media
    await locationPage.tab("Media").click();
    await page.getByLabel("File").setInputFiles({ name: "skyline.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("textbox", { name: "Caption" }).fill("Test photo");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Test photo")).toBeVisible();

    // Source
    await locationPage.tab("Source").click();
    await expect(page.getByText("Source & provenance")).toBeVisible();
    await expect(page.getByText("manual", { exact: true })).toBeVisible();

    // Delete (also removes its relation and media)
    await locationPage.deleteWithConfirm();
    console.expectNone();
  });

  test("an imported hotel shows staff-only reference data and can be verified", async ({ page, locationsPage, locationPage }) => {
    await page.goto("/locations?type=hotel&needs_verification=true");
    await locationsPage.rows.first().getByRole("link").first().click();
    await locationPage.tab("Source").click();
    await expect(page.getByText("Reference data — unverified, staff only")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark verified" })).toBeVisible();
  });
});
