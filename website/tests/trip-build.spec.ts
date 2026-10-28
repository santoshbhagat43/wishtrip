/** "Build my trip" on the Details screen of a pasted reel: the trip is planned for the party in the
 *  background and opens at its own number, filling in until the plan is ready. */
import { execSync } from "node:child_process";
import path from "node:path";

import { expect, signUp, test } from "./fixtures";

/** A reel the signed-in traveller has already pasted and we have read (no Instagram needed). */
function seedImport(email: string, stamp: string): string {
  const code = `
import asyncio
import app.db.models  # noqa
from sqlalchemy import select
from app.db.session import SessionLocal
from app.modules.reels.models import CreatorContent, ImportStatus, ReelImport
from app.modules.users.models import User
PLACES = [
  {"name": "Fort Aguada", "kind": "sight", "evidence": "the old fort", "source": "video", "location_id": None, "location_name": None, "location_type": None, "verified": False, "t": 3},
  {"name": "Anjuna fish thali", "kind": "food", "evidence": "lunch", "source": "video", "location_id": None, "location_name": None, "location_type": None, "verified": False, "t": 8},
  {"name": "Mandovi sunset cruise", "kind": "experience", "evidence": "sunset", "source": "video", "location_id": None, "location_name": None, "location_type": None, "verified": False, "t": 14},
  {"name": "Fontainhas", "kind": "sight", "evidence": "old latin quarter", "source": "video", "location_id": None, "location_name": None, "location_type": None, "verified": False, "t": 19},
  {"name": "Old Goa churches", "kind": "sight", "evidence": "churches", "source": "video", "location_id": None, "location_name": None, "location_type": None, "verified": False, "t": 23},
  {"name": "Morjim beach", "kind": "experience", "evidence": "beach", "source": "video", "location_id": None, "location_name": None, "location_type": None, "verified": False, "t": 30},
  {"name": "Zzyzx Lagoon Retreat", "kind": "stay", "evidence": "where they slept", "source": "video", "location_id": None, "location_name": None, "location_type": None, "verified": False, "t": 33},
]
async def main():
    async with SessionLocal() as s:
        user = (await s.execute(select(User).where(User.email == "${email}"))).scalar_one()
        c = CreatorContent(shortcode="Dbuild${stamp}", url="https://www.instagram.com/reel/Dbuild${stamp}/", destination_name="Goa",
                           places=PLACES, extracted={"summary": "A slow Goa trip"})
        s.add(c); await s.flush()
        j = ReelImport(url=c.url, shortcode=c.shortcode, user_id=user.id, content_id=c.id, status=ImportStatus.DONE)
        s.add(j); await s.commit()
        print(j.id)
asyncio.run(main())`;
  return execSync("docker compose exec -T backend python -", { cwd: path.resolve(__dirname, "../.."), input: code }).toString().trim().split("\n").pop()!;
}

test("Build my trip plans the reel's places for the party and opens the trip at its number", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const email = await signUp(page);
  const importId = seedImport(email, Date.now().toString(36));

  await page.goto(`/trip/details?id=${importId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Your Goa trip" })).toBeVisible();
  await page.getByRole("radio", { name: /Couple/ }).click();
  await page.getByRole("button", { name: "More days" }).last().click(); // the days they choose set the price
  // The estimate on the Details screen (desktop card)…
  const estimate = await page.locator("strong.tabular-nums").filter({ hasText: /^₹[\d,]+$/ }).last().innerText();
  await page.getByRole("button", { name: "Build my trip →" }).click();

  // It opens at its own number, and says it is being built (or is already done).
  await expect(page).toHaveURL(new RegExp(`${baseURL}/trip/mine/[a-z0-9]{8}$`));
  const tripNo = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1, name: "Your Goa trip" })).toBeVisible();
  await expect(page.getByText(/Made for you · from your reel/)).toBeVisible();
  // …is the total inside the trip, for the same travellers and days.
  await expect(page.getByText("Total for 2")).toBeVisible();
  await expect(page.locator("strong.tabular-nums").filter({ hasText: estimate }).first()).toBeVisible();

  // The plan settles: no more "Building…", every place from the reel is in it.
  await expect(page.getByText("Building your trip…")).toHaveCount(0, { timeout: 180_000 });
  await expect(page.getByText("We couldn’t build your trip just now")).toHaveCount(0);
  await expect(page.getByText(/Planned for a couple/)).toBeVisible();
  const tabs = page.getByRole("tab");
  expect(await tabs.count()).toBeGreaterThanOrEqual(2);
  const seen: string[] = [];
  for (let i = 0; i < (await tabs.count()); i++) {
    await tabs.nth(i).click();
    seen.push(await page.getByRole("tabpanel").innerText());
  }
  for (const place of ["Fort Aguada", "Anjuna fish thali", "Mandovi sunset cruise", "Fontainhas", "Old Goa churches", "Morjim beach"]) {
    expect(seen.join("\n"), place).toContain(place);
  }

  // The number brings it back as it was; Change details goes back to the reel's Details, prefilled.
  await page.goto(`/trip/mine/${tripNo}`);
  await expect(page.getByText(/Planned for a couple/)).toBeVisible();
  await page.getByRole("link", { name: "Change details" }).click();
  await expect(page).toHaveURL(new RegExp(`/trip/details\\?id=${importId}&mine=${tripNo}`));
  await expect(page.getByRole("radio", { name: /Couple/ })).toHaveAttribute("aria-checked", "true");
  // With live answers from TripJack, the price card is those, and says what is not priced.
  const now = new Date().toISOString();
  await page.route("**/my-trips/*/flight-price", (r) => r.fulfill({ json: {
    status: "priced", origin: "DEL", destination: "GOI", adults: 2, children: 0, total: 18400, checked_at: now,
    legs: [{ from_code: "DEL", to_code: "GOI", date: "2027-01-10", airline: "IndiGo", flight_number: "6E101", stops: 0, price: 10200 }],
  } }));
  // The stays are the trip's own (their ids come from the real answer); the prices are TripJack's.
  const stayAnswer = (make: (id: string) => object[]) => async (r: import("@playwright/test").Route) => {
    const res = await r.fetch();
    const real = (await res.json()) as { stays: { item_id: string }[] };
    await r.fulfill({ json: { currency: "INR", total: 13200, checked_at: now, rooms: 1, all_priced: false, stays: make(real.stays[0].item_id) } });
  };
  await page.route("**/my-trips/*/stay-prices", stayAnswer((id) => [
    { item_id: id, name: "A stay", status: "priced", total: 13200, nights: 2, meal_basis: "Breakfast" },
    { item_id: "other", name: "Another", status: "not_matched" },
  ]));
  await page.goto(`/trip/mine/${tripNo}`);
  await expect(page.getByText("Total so far for 2")).toBeVisible();
  await expect(page.locator("strong.tabular-nums").filter({ hasText: "₹31,600" }).first()).toBeVisible(); // 18,400 + 13,200
  await expect(page.getByText("1 not priced")).toBeVisible();
  await expect(page.getByText(/Experiences, meals and transfers are priced at checkout/)).toBeVisible();

  // A stay that names no hotel we hold shows its closest hotels, priced, and not in the total.
  await page.unroute("**/my-trips/*/stay-prices");
  await page.route("**/my-trips/*/stay-prices", stayAnswer((id) => [
    { item_id: id, name: "A stay", status: "not_matched", nights: 2, alternatives: [
      { hotel: { id: "h9", name: "Beach Inn Goa" }, stars: 4, total: 9100, checked_at: now, reason: "Close to the name in the reel" }] },
  ]));
  await page.goto(`/trip/mine/${tripNo}`);
  await expect(page.getByText("Beach Inn Goa").first()).toBeVisible();
  await expect(page.getByText(/Suggestions only: they are not in your total/).first()).toBeVisible();
});
