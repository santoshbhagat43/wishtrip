/**
 * The Destinations page (/destinations): the places in WishTrip's checked knowledge, with the
 * creator trips that went there. Real data only; the header's Destinations link leads here.
 */
import { API_URL, expect, test } from "./fixtures";

type Destination = { id: string; name: string; country: string | null; creator_trips: number; top_creator: { handle: string } | null };

async function destinations(request: import("@playwright/test").APIRequestContext) {
  const res = await request.get(`${API_URL}/explore/destinations`);
  expect(res.status()).toBe(200);
  return (await res.json()) as Destination[];
}

test.describe("Destinations", () => {
  test("the header's Destinations link opens the page, which lists every published destination", async ({ page, request }) => {
    const all = await destinations(request);
    expect(all.length).toBeGreaterThan(0);

    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Destinations", exact: true })).toHaveAttribute("href", "/destinations");
    await nav.getByRole("link", { name: "Destinations", exact: true }).click();
    await expect(page).toHaveURL(/\/destinations$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Where to");

    const grid = page.getByRole("region", { name: /Pick a place, see who.s been/ });
    await expect(grid.getByRole("link")).toHaveCount(all.length);
    for (const d of all.slice(0, 3)) {
      await expect(grid.getByRole("link", { name: new RegExp(d.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first()).toBeVisible();
    }
    // Each card goes to that destination's page.
    await expect(grid.getByRole("link").first()).toHaveAttribute("href", /^\/explore\/[0-9a-f-]{36}$/);
  });

  test("filters narrow the destinations to India or abroad", async ({ page, request }) => {
    const all = await destinations(request);
    const india = all.filter((d) => (d.country ?? "").toLowerCase() === "india").length;
    test.skip(india === 0 || india === all.length, "needs both Indian and foreign destinations");

    await page.goto("/destinations");
    const grid = page.getByRole("region", { name: /Pick a place, see who.s been/ });
    await expect(grid.getByRole("link")).toHaveCount(all.length);
    await grid.getByRole("button", { name: "India", exact: true }).click();
    await expect(grid.getByRole("button", { name: "India", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(grid.getByRole("link")).toHaveCount(india);
    await grid.getByRole("button", { name: "Abroad" }).click();
    await expect(grid.getByRole("link")).toHaveCount(all.length - india);
    await grid.getByRole("button", { name: "All" }).click();
    await expect(grid.getByRole("link")).toHaveCount(all.length);
  });

  test("a place a creator has been to says so, and nothing is made up", async ({ page, request }) => {
    const all = await destinations(request);
    const visited = all.find((d) => d.creator_trips > 0 && d.top_creator);
    await page.goto("/destinations");
    const grid = page.getByRole("region", { name: /Pick a place, see who.s been/ });
    if (visited) {
      const card = grid.getByRole("listitem").filter({ hasText: visited.name }).first();
      await expect(card).toContainText(`${visited.creator_trips} creator ${visited.creator_trips === 1 ? "trip" : "trips"}`);
      await expect(card).toContainText(`Top trip by @${visited.top_creator!.handle}`);
    }
    // No stock figures: no prices, best months or follower counts on the cards.
    await expect(grid.getByText(/₹|Best (Nov|Apr|Mar|Sep)|followers/i)).toHaveCount(0);

    // Ask Arya takes what they type to the planner.
    const ask = page.getByRole("textbox", { name: "Ask Arya where to go" });
    await expect(ask).toBeVisible();
    const form = page.locator("form[action='/plan']");
    await expect(form).toHaveAttribute("method", /get/i);
    await expect(ask).toHaveAttribute("name", "prompt");
  });
});
