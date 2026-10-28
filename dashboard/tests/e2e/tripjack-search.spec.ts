import { expect, test } from "../fixtures/test";

const SUPPLIER = {
  environment: "UAT (TripJack test environment)",
  trace_id: "abc123def4567890",
  served_from: "tripjack",
  upstream_ms: 812,
  server_ms: 850,
  calls: [{ endpoint: "POST apitest.tripjack.com/fms/v1/air-search-all", status: 200, ok: true, ms: 812, error: "" }],
};
const airport = (code: string, city: string) => ({ code, name: `${city} Airport`, city, country: "India", terminal: "" });
const FLIGHTS = {
  total: 2,
  supplier: SUPPLIER,
  flights: [
    {
      journey: "ONWARD",
      legs: [[{ airline: { code: "6E", name: "IndiGo", low_cost: true }, flight_number: "6E123", from: airport("DEL", "Delhi"), to: airport("GOI", "Goa"), departs: "2026-12-01T06:05", arrives: "2026-12-01T08:55", duration_minutes: 170, layover_minutes: 0, technical_stops: 0 }]],
      departs: "2026-12-01T06:05", arrives: "2026-12-01T08:55", duration_minutes: 170, stops: 0,
      airlines: [{ code: "6E", name: "IndiGo" }],
      cheapest: { price_id: "p1", fare_type: "PUBLISHED", cabin: "ECONOMY", fare_name: "SAVER", refundable: "non_refundable", baggage: { check_in: "15 KG", cabin: "7 KG" }, seats_left: 4, price: { base: 4200, taxes: 1100, total: 5300, currency: "INR" } },
      fares: [
        { price_id: "p1", fare_type: "PUBLISHED", cabin: "ECONOMY", fare_name: "SAVER", refundable: "non_refundable", baggage: { check_in: "15 KG", cabin: "7 KG" }, seats_left: 4, price: { base: 4200, taxes: 1100, total: 5300, currency: "INR" } },
        { price_id: "p2", fare_type: "PUBLISHED", cabin: "ECONOMY", fare_name: "FLEXI", refundable: "refundable", baggage: { check_in: "20 KG", cabin: "7 KG" }, seats_left: null, price: { base: 5600, taxes: 1100, total: 6700, currency: "INR" } },
      ],
    },
    {
      journey: "ONWARD",
      legs: [[
        { airline: { code: "AI", name: "Air India", low_cost: false }, flight_number: "AI101", from: airport("DEL", "Delhi"), to: airport("BOM", "Mumbai"), departs: "2026-12-01T09:00", arrives: "2026-12-01T11:10", duration_minutes: 130, layover_minutes: 95, technical_stops: 0 },
        { airline: { code: "AI", name: "Air India", low_cost: false }, flight_number: "AI663", from: airport("BOM", "Mumbai"), to: airport("GOI", "Goa"), departs: "2026-12-01T12:45", arrives: "2026-12-01T14:00", duration_minutes: 75, layover_minutes: 0, technical_stops: 0 },
      ]],
      departs: "2026-12-01T09:00", arrives: "2026-12-01T14:00", duration_minutes: 300, stops: 1,
      airlines: [{ code: "AI", name: "Air India" }],
      cheapest: { price_id: "p3", fare_type: "PUBLISHED", cabin: "ECONOMY", fare_name: "ECO", refundable: "partially_refundable", baggage: { check_in: "25 KG", cabin: "8 KG" }, seats_left: 9, price: { base: 6100, taxes: 1500, total: 7600, currency: "INR" } },
      fares: [{ price_id: "p3", fare_type: "PUBLISHED", cabin: "ECONOMY", fare_name: "ECO", refundable: "partially_refundable", baggage: { check_in: "25 KG", cabin: "8 KG" }, seats_left: 9, price: { base: 6100, taxes: 1500, total: 7600, currency: "INR" } }],
    },
  ],
};
const RULES = { supplier: SUPPLIER, sectors: { "DEL-GOI": { CANCELLATION: [{ from_hours: 0, to_hours: 4, period: "HOURS", airline_fee: 3500, service_fee: 300, note: "" }, { from_hours: 4, to_hours: 9999, period: "HOURS", airline_fee: 0, service_fee: 0, note: "" }] } } };

const OPTION = (id: string, total: number, refundable: boolean) => ({
  option_id: id, option_type: "SINGLE", rooms: [{ name: "Superior Room", adults: 2 }], meal_basis: "Breakfast", inclusions: ["Free WiFi"], booking_notes: "",
  price: { base: total - 3000, taxes: 3000, management_fee: 0, management_fee_tax: 0, discount: 0, total, currency: "INR" },
  needs_pan: false, needs_passport: false, gst_type: "NA",
  cancellation: { refundable, free_until: refundable ? "2026-11-28T12:00:00+05:30" : null, slabs: [] },
});
const HOTELS = {
  total: 1, correlation_id: "c1", region: { region_id: 1, city: "GOA", country: "INDIA" }, supplier: SUPPLIER,
  hotels: [{ hotel_id: "100001538018", name: "La Estoria, Goa", stars: 4, property_type: "Hotel", address: "Calangute, Goa", hero_image: "https://img.example/h.jpg", amenities: ["Pool"], rank: 9, option: OPTION("o1", 20193.65, true) }],
};
const HOTEL_DETAIL = {
  correlation_id: "c1", supplier: SUPPLIER,
  hotel: { name: "La Estoria, Goa", headline: "A calm stay by the beach", images: [{ caption: "Pool", url: "https://img.example/p.jpg" }] },
  options: [OPTION("o1", 20193.65, true), OPTION("o2", 24800, false)],
};

test.describe("TripJack search", () => {
  test("staff search flights and see fares, baggage and the cancellation rules", async ({ page, apiLog: _ }) => {
    await page.route("**/api/backend/flights/search", (route) => route.fulfill({ json: FLIGHTS }));
    await page.route("**/api/backend/flights/fare-rules", (route) => route.fulfill({ json: RULES }));
    await page.goto("/tripjack/flights");
    await expect(page.getByRole("heading", { name: "TripJack flights" })).toBeVisible();
    await page.getByRole("button", { name: "Search flights" }).click();

    await expect(page.getByTestId("supplier-note")).toContainText("Live from TripJack");
    await expect(page.getByTestId("supplier-note")).toContainText("UAT (test prices)");
    const rows = page.getByTestId("flight-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("IndiGo");
    await expect(rows.first()).toContainText("₹5,300");
    await expect(rows.first()).toContainText("Direct");
    await expect(rows.nth(1)).toContainText("1 stop");

    await rows.first().getByRole("button", { expanded: false }).click();
    await expect(rows.first()).toContainText("FLEXI");
    await expect(rows.first()).toContainText("₹6,700");
    await expect(rows.first()).toContainText("Non-refundable");
    await expect(rows.first()).toContainText("Check-in 15 KG");
    await rows.first().getByRole("button", { name: "Cancellation and change rules" }).first().click();
    await expect(rows.first()).toContainText("DEL-GOI");
    await expect(rows.first()).toContainText("₹3,500");

    // The way back to what we sent and what TripJack answered.
    await expect(page.getByRole("link", { name: /See the request and response/ })).toHaveAttribute("href", "/tripjack/log?q=abc123def4567890");
  });

  test("staff search hotels in a city and open one for its room options", async ({ page, apiLog: _ }) => {
    await page.route("**/api/backend/hotels/destinations**", (route) => route.fulfill({ json: [{ region_id: 1, city: "GOA", country: "INDIA", name: "GOA, INDIA" }] }));
    await page.route("**/api/backend/hotels/search", (route) => route.fulfill({ json: HOTELS }));
    await page.route("**/api/backend/hotels/*/pricing", (route) => route.fulfill({ json: HOTEL_DETAIL }));
    await page.goto("/tripjack/hotels");
    await expect(page.getByRole("button", { name: "Search hotels" })).toBeDisabled(); // pick a city first
    await page.getByLabel("Where").fill("Go");
    await page.getByRole("option", { name: /GOA/ }).click();
    await page.getByRole("button", { name: "Search hotels" }).click();

    const card = page.getByTestId("hotel-card");
    await expect(card).toContainText("La Estoria, Goa");
    await expect(card).toContainText("₹20,194");
    await expect(card).toContainText("refundable");
    await expect(card.locator("img")).toHaveAttribute("src", "https://img.example/h.jpg");

    await card.getByRole("button").click();
    const dialog = page.getByRole("dialog", { name: "La Estoria, Goa" });
    await expect(dialog.getByTestId("room-option")).toHaveCount(2);
    await expect(dialog.getByTestId("room-option").first()).toContainText("Free cancellation until");
    await expect(dialog.getByTestId("room-option").nth(1)).toContainText("Non-refundable");
    await expect(dialog.getByTestId("room-option").nth(1)).toContainText("₹24,800");
  });

  test("a search TripJack cannot answer says so", async ({ page, apiLog: _ }) => {
    await page.route("**/api/backend/flights/search", (route) => route.fulfill({ status: 503, json: { detail: "Flight search is not set up yet" } }));
    await page.goto("/tripjack/flights");
    await page.getByRole("button", { name: "Search flights" }).click();
    await expect(page.getByText("Flight search is not set up yet")).toBeVisible();
  });

  test("the menu has a TripJack section", async ({ page, apiLog: _ }) => {
    await page.goto("/tripjack");
    await expect(page).toHaveURL(/\/tripjack\/flights$/);
    for (const name of ["Flights", "Hotels", "Hotel matches", "Call log"]) {
      await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    }
  });
});
