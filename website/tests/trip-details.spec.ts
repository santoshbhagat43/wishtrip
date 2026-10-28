/**
 * Trip board details: a click on a stop opens its details (a stay with no hotel match offers the
 * closest alternatives), and the Flights card opens a live flight search. The trip and the
 * supplier's answers are canned here so the test checks the board, not TripJack's catalogue.
 */
import type { Page } from "@playwright/test";

import { expect, signUp, test } from "./fixtures";

const CODE = "e2e-details-1";
const hotel = (id: string, name: string, extra = {}) => ({
  id,
  name,
  stars: 5,
  property_type: "Resort",
  address: "Seminyak, Bali",
  city: "Bali",
  country: "Indonesia",
  headline: "Pool villas by the beach",
  description: "A calm resort with pool villas.",
  amenities: ["Pool", "Spa"],
  images: [{ url: "/b4/px-bali-resort.webp", caption: "Pool" }],
  ...extra,
});

async function tripBoard(page: Page) {
  await page.route(`**/api/wt/trips/${CODE}`, (route) =>
    route.fulfill({
      json: {
        title: "Bali slow trip",
        destination_name: "Bali",
        summary: "",
        cover_image_url: null,
        creator: { handle: "e2ecreator", display_name: "E2E Creator", referral_code: "e2ecreator" },
        items: [
          { id: "stay1", kind: "stay", name: "Hotel Paradise", note: "", day: 1, origin: "reel", verified: false },
          { id: "sight1", kind: "sight", name: "Tanah Lot", day: 1, origin: "reel", verified: true, note: "Go at sunset" },
        ],
      },
    }),
  );
  await page.route(`**/api/wt/trips/${CODE}/stops/stay1`, (route) =>
    route.fulfill({
      json: {
        id: "stay1", kind: "stay", name: "Hotel Paradise", note: "", origin: "reel", at_seconds: 23, hotel: null, place: null,
        alternatives: [{ hotel: hotel("11111111-1111-1111-1111-111111111111", "Bali Paradise Beach"), reason: "Close to the name in the reel" }],
      },
    }),
  );
  await page.route(`**/api/wt/trips/${CODE}/stops/sight1`, (route) =>
    route.fulfill({
      json: {
        id: "sight1", kind: "sight", name: "Tanah Lot", note: "Go at sunset", origin: "reel", at_seconds: null, hotel: null, alternatives: [],
        place: { summary: "A sea temple on a rock", description: "", address: "Tabanan", duration_minutes: 90, best_times: ["evening"], price_note: "", pros: [], cons: [], tips: "Check the tide" },
      },
    }),
  );
  await page.goto(`/t/${CODE}`);
}

test.describe("Trip board details", () => {
  test("a stay with no hotel match offers alternatives; a place shows what we know", async ({ page }) => {
    await tripBoard(page);
    await expect(page.getByText("No exact hotel match · see alternatives")).toBeVisible();

    await page.getByRole("button", { name: "Hotel Paradise" }).click();
    const dialog = page.getByRole("dialog", { name: "Hotel Paradise" });
    await expect(dialog.getByText(/couldn.t match .Hotel Paradise. to a hotel we hold/)).toBeVisible();
    await expect(dialog.getByText("Bali Paradise Beach")).toBeVisible();
    await expect(dialog.getByText("Close to the name in the reel")).toBeVisible();
    await dialog.getByRole("button", { name: "See details" }).click();
    await expect(dialog.getByText("A calm resort with pool villas.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "Tanah Lot" }).click();
    const place = page.getByRole("dialog", { name: "Tanah Lot" });
    await expect(place.getByText("A sea temple on a rock")).toBeVisible();
    await expect(place.getByText("1 h 30 min")).toBeVisible();
    await expect(place.getByText("Check the tide")).toBeVisible();
  });

  test("the Flights card asks a signed-out visitor to sign in", async ({ page }) => {
    await tripBoard(page);
    await page.getByRole("button", { name: /FLIGHTS/ }).click();
    const dialog = page.getByRole("dialog", { name: "Flights to Bali" });
    await expect(dialog.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("a signed-in traveller searches flights and opens one for its details", async ({ page }) => {
    await signUp(page);
    await page.route("**/api/wt/flights/search", (route) =>
      route.fulfill({
        json: {
          total: 1,
          flights: [{
            journey: "ONWARD", departs: "2027-01-10T06:00", arrives: "2027-01-10T14:30", duration_minutes: 510, stops: 1,
            airlines: [{ code: "6E", name: "IndiGo" }],
            legs: [[
              { airline: { code: "6E", name: "IndiGo" }, flight_number: "6E123", from: { code: "BLR", city: "Bengaluru", terminal: "T1" }, to: { code: "SIN", city: "Singapore", terminal: "" }, departs: "2027-01-10T06:00", arrives: "2027-01-10T12:00", duration_minutes: 270, layover_minutes: 90 },
              { airline: { code: "6E", name: "IndiGo" }, flight_number: "6E456", from: { code: "SIN", city: "Singapore", terminal: "" }, to: { code: "DPS", city: "Denpasar", terminal: "" }, departs: "2027-01-10T13:30", arrives: "2027-01-10T14:30", duration_minutes: 120, layover_minutes: 0 },
            ]],
            cheapest: { price_id: "p1", fare_name: "Saver", cabin: "ECONOMY", refundable: "non_refundable", baggage: { check_in: "15 KG", cabin: "7 KG" }, seats_left: 4, price: { total: 24500, base: 20000, taxes: 4500 } },
            fares: [{ price_id: "p1", fare_name: "Saver", cabin: "ECONOMY", refundable: "non_refundable", baggage: { check_in: "15 KG", cabin: "7 KG" }, seats_left: 4, price: { total: 24500, base: 20000, taxes: 4500 } }],
          }],
        },
      }),
    );
    await tripBoard(page);
    await page.getByRole("button", { name: /FLIGHTS/ }).click();
    const dialog = page.getByRole("dialog", { name: "Flights to Bali" });
    await dialog.getByLabel("From (airport code)").fill("blr");
    await dialog.getByLabel("To (airport code)").fill("dps");
    await dialog.getByRole("button", { name: "Search flights" }).click();
    await dialog.getByRole("button", { name: /IndiGo/ }).click();
    await expect(dialog.getByText("IndiGo 6E123")).toBeVisible();
    await expect(dialog.getByText(/Layover 1h 30m in Singapore/)).toBeVisible();
    await expect(dialog.getByText(/Non-refundable · Check-in 15 KG/)).toBeVisible();
    await expect(dialog.getByText("Live fares from TripJack", { exact: false })).toBeVisible();
  });
});
