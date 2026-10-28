/** Holding and booking a TripJack flight from the dashboard (TripJack's answers mocked). */
import { expect, test } from "../fixtures/test";

const SUPPLIER = {
  environment: "UAT (TripJack test environment)", trace_id: "abc123def4567890", served_from: "tripjack",
  upstream_ms: 500, server_ms: 520, calls: [],
};
const airport = (code: string, city: string) => ({ code, name: `${city} Airport`, city, country: "India", terminal: "" });
const FARE = { price_id: "p1", fare_type: "PUBLISHED", cabin: "ECONOMY", fare_name: "SAVER", refundable: "non_refundable", baggage: { check_in: "15 KG", cabin: "7 KG" }, seats_left: 4, price: { base: 4200, taxes: 1100, total: 5300, currency: "INR" } };
const FLIGHTS = {
  total: 1, supplier: SUPPLIER,
  flights: [{
    journey: "ONWARD",
    legs: [[{ airline: { code: "6E", name: "IndiGo", low_cost: true }, flight_number: "6E123", from: airport("DEL", "Delhi"), to: airport("GOI", "Goa"), departs: "2026-12-01T06:05", arrives: "2026-12-01T08:55", duration_minutes: 170, layover_minutes: 0, technical_stops: 0 }]],
    departs: "2026-12-01T06:05", arrives: "2026-12-01T08:55", duration_minutes: 170, stops: 0,
    airlines: [{ code: "6E", name: "IndiGo" }], cheapest: FARE, fares: [FARE],
  }],
};
const REVIEW = {
  booking_id: "TJS100", total: 5150, currency: "INR", hold_allowed: true, session_seconds: 900, session_started: null,
  needs: { pan: false, passport: false, passport_expiry: false, dob_adult: false, dob_child: false, dob_infant: false, gst: false, emergency_contact: false },
  alerts: [], raw: { bookingId: "TJS100" }, supplier: SUPPLIER,
};
const later = new Date(Date.now() + 6 * 3600_000 + 5 * 60_000).toISOString();
const HELD = {
  booking_id: "TJS100", status: "ON_HOLD", amount: 0, total: 5150, pnrs: ["ABC123"], tickets: [],
  travellers: [{ name: "Asha Rao", type: "ADULT" }], created_on: "2026-10-28",
  hold_deadlines: { "itemInfos.AIR.timeLimit": later }, raw: {}, supplier: SUPPLIER,
};

test("staff review a fare, hold it, see when the hold runs out and release it", async ({ page, apiLog: _ }) => {
  let booked: Record<string, unknown> = {};
  let status = "ON_HOLD";
  await page.route("**/api/backend/flights/search", (r) => r.fulfill({ json: FLIGHTS }));
  await page.route("**/api/backend/flights/review", (r) => r.fulfill({ json: REVIEW }));
  await page.route("**/api/backend/flights/book", (r) => {
    booked = r.request().postDataJSON();
    return r.fulfill({ json: { booking_id: "TJS100", mode: "hold", raw: {}, supplier: SUPPLIER } });
  });
  await page.route("**/api/backend/flights/bookings/TJS100/release", (r) => {
    status = "UNCONFIRMED";
    return r.fulfill({ json: { booking_id: "TJS100", pnrs: ["ABC123"], raw: {}, supplier: SUPPLIER } });
  });
  await page.route("**/api/backend/flights/bookings/TJS100", (r) => r.fulfill({ json: { ...HELD, status } }));

  await page.goto("/tripjack/flights");
  await page.getByRole("button", { name: "Search flights" }).click();
  const row = page.getByTestId("flight-row").first();
  await row.getByRole("button", { expanded: false }).click();
  await row.getByRole("button", { name: "Review to hold or book" }).click();
  await expect(row).toContainText("Hold allowed");
  await expect(row).toContainText("₹5,150"); // TripJack's own total, what we pay
  await expect(row).toContainText("Review good for 15 min");

  await row.getByLabel("First name 1").fill("Asha");
  await row.getByLabel("Last name 1").fill("Rao");
  await row.getByLabel("Booking email").fill("test@example.com");
  await row.getByLabel("Booking phone").fill("+919500112233");
  await row.getByRole("button", { name: "Hold (no payment)" }).click();
  expect(booked).toMatchObject({ booking_id: "TJS100", mode: "hold", email: "test@example.com", travellers: [{ first_name: "Asha", last_name: "Rao" }] });
  expect(booked.amount).toBeUndefined();

  const card = page.getByTestId("tripjack-booking");
  await expect(card).toContainText("ON_HOLD");
  await expect(card).toContainText("PNR ABC123");
  await expect(card).toContainText("Hold runs out");
  await expect(card).toContainText(/6 h \d+ min from now/);

  page.on("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Release the hold" }).click();
  await expect(card).toContainText("UNCONFIRMED");
});

test("a booking made earlier opens by its id", async ({ page, apiLog: _ }) => {
  await page.route("**/api/backend/flights/bookings/TJS100", (r) => r.fulfill({ json: HELD }));
  await page.goto("/tripjack/flights");
  await page.getByLabel("TripJack booking id").fill("TJS100");
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByTestId("tripjack-booking")).toContainText("ON_HOLD");
});
