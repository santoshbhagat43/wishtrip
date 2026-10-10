import { expect, test, watchConsoleErrors } from "../fixtures/test";

const PAGES: [link: string, heading: string][] = [
  ["Overview", "Overview"],
  ["Locations", "Locations"],
  ["Hierarchy", "Hierarchy"],
  ["Tags", "Tags"],
  ["Semantic search", "Semantic search"],
  ["Travelers", "Travelers"],
  ["Staff users", "Staff users"],
  ["Audit log", "Audit log"],
];

test.describe("Navigation", () => {
  test("every sidebar page opens without errors", async ({ page, apiLog }) => {
    const console = watchConsoleErrors(page);
    await page.goto("/");
    for (const [link, heading] of PAGES) {
      await page.getByRole("navigation").getByRole("link", { name: link, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
    await page.getByRole("navigation").getByRole("link", { name: "Trip chat", exact: true }).click();
    await expect(page.getByPlaceholder(/Where do you want to go/)).toBeVisible();
    console.expectNone();
    expect(apiLog.filter((c) => c.status >= 500), "no server errors").toEqual([]);
  });
});

test.describe("Overview", () => {
  test("shows knowledge stats, attention items and AI status", async ({ page, apiLog: _ }) => {
    await page.goto("/");
    for (const label of ["Places", "Cities", "Published", "Drafts"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    await expect(page.getByText(/to verify/)).toBeVisible();
    await expect(page.getByText(/AI offline|Chat model/)).toBeVisible();
    await page.getByRole("link", { name: /to verify/ }).click();
    await expect(page).toHaveURL(/needs_verification=true/);
    await expect(page.getByText("Verify").first()).toBeVisible();
  });
});
