/**
 * The home page, as in the "final white" prototype: the scroll story, Arya, the trust points, and
 * (from real data) the creator trips and destinations. The header's search finds real places,
 * creators and trips.
 */
import { API_URL, expect, test } from "./fixtures";

type Dest = { id: string; name: string };
type Creators = { all: { slug: string; handle: string | null; display_name: string; trips: { title: string }[] }[] };

test.describe("Home", () => {
  test("the story goes from six apps to one board, and the example says it is an example", async ({ page }) => {
    await page.goto("/");
    const h1 = page.getByRole("heading", { level: 1 }).filter({ visible: true });
    await expect(h1).toContainText("Your trip lives in 6 different apps.");
    await expect(page.getByText("SOUND FAMILIAR?").filter({ visible: true })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 700));
    await expect(h1).toContainText("Now it’s all in one place");
    await expect(page.getByText("Arya turns them into one plan.").filter({ visible: true })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 1700));
    await expect(h1).toContainText("Your whole trip, booked in one go.");
    const board = page.locator("div").filter({ hasText: /^Bali for two, made yours/ }).filter({ visible: true }).first();
    await expect(board).toBeVisible();
    for (const text of ["Bali in 7 days", "BLR → Bali (DPS)", "Kuta pool resort", "Tanah Lot temple", "Private car daily", "Sunset cruise"]) {
      await expect(page.getByText(text, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    }
    // The price is an example, and says so.
    await expect(page.getByText("Example trip · for 2, all-in, one checkout").filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Plan my trip →" }).filter({ visible: true })).toBeVisible();
  });

  test("below the story: Arya, the trust points, and nothing invented", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "One chat. Your whole trip." })).toBeVisible();
    await expect(page.getByText("Example conversation · an illustration of how Arya works")).toBeVisible();
    await expect(page.getByText("Bali for 7 days, just the two of us. Under ₹1.5L.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "An agent you can trust with the booking" })).toBeVisible();
    for (const t of ["One price, all-in", "Pay only on your OK", "A real person on WhatsApp", "Creators get credited"]) {
      await expect(page.getByText(t, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Start with whatever you have" })).toBeVisible();
    // The sections with made-up numbers are not on the page: no booking counts, no traveller stories.
    await expect(page.getByText(/booked this trip|Booked on wishtrip|Most booked|travellers like you|1,240 trips|planning now/i)).toHaveCount(0);
    // The creator earnings card is labelled as an example, with no real figures.
    await expect(page.getByText("EXAMPLE · YOUR CREATOR DASHBOARD")).toBeVisible();
  });

  test("the creator trips and destinations are the real ones", async ({ page, request }) => {
    const dests = (await (await request.get(`${API_URL}/explore/destinations`)).json()) as Dest[];
    const creators = (await (await request.get(`${API_URL}/explore/creators`)).json()) as Creators;
    await page.goto("/");
    const band = page.locator("#b4-explore");

    const trips = creators.all.flatMap((c) => c.trips.map((t) => ({ ...t, handle: c.handle })));
    if (trips.length > 0) {
      await expect(band.getByRole("heading", { name: "Travel creators in the spotlight" })).toBeVisible();
      await expect(band.getByRole("article", { name: /^1 of \d+:/ })).toBeVisible();
      if (trips.length > 1) {
        await band.getByRole("button", { name: "Next trip" }).click();
        await expect(band.getByRole("article", { name: /^2 of \d+:/ })).toBeVisible();
        await expect(band.getByRole("article", { name: /^1 of \d+:/ })).toHaveCount(0);
        await band.getByRole("button", { name: "Previous trip" }).click();
        await expect(band.getByRole("article", { name: /^1 of \d+:/ })).toBeVisible();
      }
      await expect(band.getByRole("link", { name: "Plan this trip" }).first()).toHaveAttribute("href", /^\/plan\?prompt=/);
    } else {
      await expect(band.getByRole("heading", { name: "Travel creators in the spotlight" })).toHaveCount(0);
    }

    if (dests.length > 0) {
      await expect(band.getByRole("heading", { name: "Destinations to explore" })).toBeVisible();
      const rail = band.getByRole("list").filter({ hasText: "places" });
      await expect(rail.getByRole("link").first()).toHaveAttribute("href", /^\/explore\/[0-9a-f-]{36}$/);
      // No prices, season tags or "planning now" counts on the cards.
      await expect(rail.getByText(/₹|Peak season|planning now/)).toHaveCount(0);
    }
  });

  test("the header search finds places, creators and trips", async ({ page, request }) => {
    const dests = (await (await request.get(`${API_URL}/explore/destinations`)).json()) as Dest[];
    const creators = (await (await request.get(`${API_URL}/explore/creators`)).json()) as Creators;
    await page.goto("/");
    const search = page.getByRole("combobox", { name: "Search places, creators, trips" }).filter({ visible: true });
    await expect(search).toBeVisible();

    const dest = dests[0];
    await search.fill(dest.name.slice(0, 4));
    const results = page.getByRole("listbox", { name: "Search results" });
    await expect(results.getByText("PLACES", { exact: true })).toBeVisible();
    await expect(results.getByRole("option", { name: new RegExp(dest.name.slice(0, 4), "i") }).first()).toBeVisible();

    const creator = creators.all[0];
    if (creator) {
      const label = creator.handle ? `@${creator.handle}` : creator.display_name;
      await search.fill(label.slice(0, 6));
      await expect(results.getByText("CREATORS", { exact: true })).toBeVisible();
      await expect(results.getByRole("option", { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first()).toBeVisible();
      await search.fill(creator.trips[0].title.split(" ")[0]);
      await expect(results.getByText("TRIPS", { exact: true })).toBeVisible();
    }

    await search.fill("zzzzqqqq");
    await expect(results.getByText(/Nothing matches/)).toBeVisible();
    await search.press("Escape");
    await expect(results).toHaveCount(0);

    // Picking a place opens it.
    await search.fill(dest.name);
    await results.getByRole("option", { name: new RegExp(dest.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first().click();
    await expect(page).toHaveURL(new RegExp(`/explore/${dest.id}$`));
  });

  test("on a phone the search is a button next to the menu, and the board stacks its cards", async ({ page, request }) => {
    const dests = (await (await request.get(`${API_URL}/explore/destinations`)).json()) as Dest[];
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("combobox", { name: "Search places, creators, trips" }).filter({ visible: true })).toHaveCount(0);

    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect(page.getByText("Bali, 7 days for two").filter({ visible: true })).toBeVisible();
    await expect(page.getByText("Example trip · for 2, all-in", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText("Seats together").filter({ visible: true })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("button", { name: "Search" }).click();
    const search = page.getByRole("combobox", { name: "Search places, creators, trips" });
    await expect(search).toBeFocused();
    await search.fill(dests[0].name.slice(0, 4));
    await expect(page.getByRole("option", { name: new RegExp(dests[0].name.slice(0, 4), "i") }).first()).toBeVisible();
  });
});
