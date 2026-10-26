import { execSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "../fixtures/test";

/** A trip with one stay, and two TripJack hotels in the catalogue (no real TripJack needed). */
function seed(stamp: string) {
  const code = `
import asyncio, uuid
import app.db.models
from app.db.session import SessionLocal
from app.modules.creators.models import Creator, CreatorTrip
from app.modules.hotels.models import SupplierHotel
async def main():
    async with SessionLocal() as s:
        c = Creator(email="e2e-hm-${stamp}@creators.example.com", status="active", referral_code="hm${stamp}")
        s.add(c); await s.flush()
        s.add(CreatorTrip(creator_id=c.id, title="Hotel match trip ${stamp}", destination_name="Bali", items=[
            {"id": "stay-${stamp}", "kind": "stay", "name": "Zorbeach ${stamp} Hotel or similar", "day": 1}]))
        for n, name in enumerate(["Zorbeach ${stamp} Hotel Bali", "Zorbeach ${stamp} Retreat Ubud"]):
            s.add(SupplierHotel(tj_hotel_id=f"hm${stamp}{n}", region_id=1, name=name, city="Bali", country="Indonesia",
                                hero_image=f"https://img.example/hm{n}.jpg"))
        await s.commit()
asyncio.run(main())`;
  execSync("docker compose exec -T backend python -", { cwd: path.resolve(__dirname, "../../.."), input: code, stdio: ["pipe", "ignore", "inherit"] });
}

test.describe("Hotel matches", () => {
  test("staff see a stay matched to a TripJack hotel, pick another, and say none fits", async ({ page, apiLog: _ }) => {
    const stamp = Date.now().toString(36);
    seed(stamp);
    await page.goto("/hotel-matches");
    await expect(page.getByRole("heading", { name: "Hotel matches" })).toBeVisible();
    await page.getByLabel("Search").fill(stamp);
    await page.getByRole("button", { name: "Search" }).click();

    const row = page.locator("tr", { hasText: `Hotel match trip ${stamp}` });
    await expect(row).toContainText(`Zorbeach ${stamp} Hotel or similar`); // as the creator wrote it
    await expect(row).toContainText(`Zorbeach ${stamp} Hotel Bali`); // the TripJack hotel it was matched to
    await expect(row.getByText("Matched", { exact: true })).toBeVisible();
    await expect(row.locator("img")).toHaveAttribute("src", "https://img.example/hm0.jpg");

    // Change: the other hotel is offered, with its photo.
    await row.getByRole("button", { name: "Change" }).click();
    const dialog = page.getByRole("dialog", { name: "Choose the hotel" });
    await expect(dialog.getByText(`Zorbeach ${stamp} Retreat Ubud`)).toBeVisible();
    await dialog.locator("li", { hasText: `Zorbeach ${stamp} Retreat Ubud` }).getByRole("button", { name: "This one" }).click();
    await expect(row.getByText("Confirmed", { exact: true })).toBeVisible();
    await expect(row).toContainText(`Zorbeach ${stamp} Retreat Ubud`);

    // None fits: nothing is shown, and the stay is not matched again.
    await row.getByRole("button", { name: "No hotel fits" }).click();
    await expect(row.getByText("No hotel fits", { exact: true }).first()).toBeVisible();
    await expect(row.locator("img")).toHaveCount(0);

    // Match again goes back to the name match.
    await row.getByRole("button", { name: "Match again" }).click();
    await expect(row.getByText("Matched", { exact: true })).toBeVisible();
  });
});
