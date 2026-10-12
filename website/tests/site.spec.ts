import { expect, signUp, test } from "./fixtures";

test.describe("Public site", () => {
  test("landing and explore work signed out, private pages ask to sign in", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Make it yours");
    await expect(page.getByText("Where we can take you")).toBeVisible();
    await page.getByRole("link", { name: "Explore destinations" }).first().click();
    await expect(page.getByRole("heading", { name: "Explore destinations" })).toBeVisible();
    await page.getByRole("link", { name: /Munnar tea hills/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Munnar tea hills" })).toBeVisible();
    await expect(page.getByText("Create a free account")).toBeVisible();
    await expect(page.getByText("not available yet").first()).toBeVisible();

    await page.goto("/plan");
    await expect(page).toHaveURL(/\/login\?next=%2Fplan/);

    // The gateway only forwards traveler routes; staff APIs don't exist from here.
    expect((await request.get("/api/wt/admin/users")).status()).toBe(404);
    expect((await request.get("/api/wt/admin/locations")).status()).toBe(404);
  });

  test("a place page shows checked facts and never invents a price", async ({ page }) => {
    await page.goto("/explore");
    await page.getByRole("link", { name: /Munnar tea hills/ }).click();
    await page.getByRole("link", { name: /tea gardens/i }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/tea/i);
    await expect(page.getByText("How long")).toBeVisible();
    await expect(page.getByText("not available yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up to save" })).toBeVisible();
  });
});

test.describe("Navigation", () => {
  test("the header renders the menu staff configured, not a hard-coded list", async ({ page, request }) => {
    const menus = await (await request.get("/api/wt/explore/menus?placement=header")).json();
    const labels: string[] = menus.flatMap((m: { items: { label: string }[] }) => m.items.map((i) => i.label));
    expect(labels.length, "a header menu is configured (run seed_support_menus)").toBeGreaterThan(0);

    // The header falls back to built-in links until the menus land, so wait for the call.
    const loaded = page.waitForResponse((r) => r.url().includes("/explore/menus"));
    await page.goto("/explore");
    expect((await loaded).status()).toBe(200);
    await expect(page.getByRole("navigation").getByRole("link", { name: "Explore" })).toBeVisible();
  });
});

test.describe("Session isolation", () => {
  test("a staff dashboard session never signs you in to the website", async ({ page, context, baseURL }) => {
    // Browsers share cookies across ports of one host: plant dashboard-style cookies here.
    const domain = new URL(baseURL!).hostname;
    await context.addCookies(
      ["wishtrip_staff_session", "wishtrip_staff_refresh", "wt_access", "wt_refresh"].map((name) => ({
        name, value: "staff-token", domain, path: "/",
      })),
    );
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await page.goto("/plan");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Traveler journey", () => {
  test("sign up, set preferences, get personalised picks, save a place", async ({ page }) => {
    await signUp(page);
    await page.getByLabel("Usually travelling").selectOption("couple");
    await page.getByLabel("Pace").selectOption("2");
    await page.getByRole("button", { name: "evening", exact: true }).click();
    await page.getByRole("button", { name: "Scenic views", exact: true }).click();
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.goto("/explore");
    await page.getByRole("link", { name: /Fort Kochi/ }).click();
    await expect(page.getByRole("tab", { name: "Picked for you" })).toBeVisible();
    const firstPick = page.locator("article").first();
    await expect(firstPick).toBeVisible();
    const placeName = (await firstPick.locator("a.font-display").textContent())!.trim();
    await firstPick.getByRole("button", { name: "Save" }).click();
    await expect(firstPick.getByRole("button", { name: "Saved" })).toBeVisible();

    await page.getByRole("link", { name: "Saved", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Saved places" })).toBeVisible();
    await expect(page.getByRole("link", { name: placeName })).toBeVisible();
    // Un-save
    await page.locator("article").filter({ hasText: placeName }).getByRole("button", { name: "Saved" }).click();
    await page.reload();
    await expect(page.getByText("Nothing saved yet")).toBeVisible();
  });

  test("plan a trip in chat: grounded answer, checked itinerary, honest booking", async ({ page }) => {
    await signUp(page);
    await page.goto("/plan");
    await expect(page.getByRole("heading", { name: "Where to next?" })).toBeVisible();

    // Intent modes that aren't built yet say so instead of pretending.
    await page.getByRole("tab", { name: "Paste a link" }).click();
    await expect(page.getByText(/Coming soon — we can.t read reels/)).toBeVisible();
    await page.getByRole("tab", { name: "Screenshot" }).click();
    await expect(page.getByText(/Coming soon — planning from a screenshot/)).toBeVisible();
    await page.getByRole("tab", { name: "Describe it" }).click();

    const reply = page.waitForResponse((r) => /\/api\/wt\/chat\/sessions\/[^/]+\/messages/.test(r.url()), { timeout: 200_000 });
    await page.getByPlaceholder(/4 days in Munnar/).fill("Plan 3 relaxed days in Kerala for my parents, they love nature and tea gardens");
    await page.getByRole("button", { name: "Send" }).click();
    expect((await reply).status()).toBe(200);

    await expect(page.getByText(/From places WishTrip has checked|Includes some general suggestions/)).toBeVisible();
    await expect(page.getByText("not available yet").first()).toBeVisible();
    await expect(page.getByRole("complementary").getByText("Kerala", { exact: true }).first()).toBeVisible();

    const plan = page.getByText(/Checked — /).first();
    if (await plan.isVisible()) {
      await expect(page.getByText(/^Day 1/).first()).toBeVisible();
      await page.getByRole("button", { name: "Book this trip" }).click();
      await expect(page.getByRole("dialog", { name: "Booking" })).toContainText("Booking isn't live yet");
    }
  });
});
