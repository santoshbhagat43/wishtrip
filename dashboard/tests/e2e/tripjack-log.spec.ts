import { execSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "../fixtures/test";

/** Two calls in the log, as the backend would have recorded them (no real TripJack needed). */
function seed(stamp: string) {
  const code = `
import asyncio
from app.db.session import SessionLocal
from app.modules.tripjack.models import TripJackLog
async def main():
    async with SessionLocal() as s:
        s.add(TripJackLog(product="hotels", method="POST", url="https://apitest-hms.tripjack.com/hms/v3/hotel/listing",
            path="/hms/v3/hotel/listing", request_headers={"apikey": "…6789", "Content-Type": "application/json"},
            request_body={"checkIn": "2026-12-01", "hids": [1], "marker": "${stamp}"}, status=200,
            response_body='{"status":{"success":true},"hotels":[{"name":"La Estoria ${stamp}"}]}', response_bytes=70,
            ms=412, ok=True, trace_id="t${stamp}", environment="UAT (TripJack test environment)"))
        s.add(TripJackLog(product="flights", method="POST", url="https://apitest.tripjack.com/fms/v1/air-search-all",
            path="/fms/v1/air-search-all", request_headers={"apikey": "…6789"}, request_body={"searchQuery": {}},
            status=400, response_body='{"errors":[{"errCode":"2001","message":"bad ${stamp}"}]}', response_bytes=55, ms=90,
            ok=False, error="2001: bad ${stamp}", trace_id="f${stamp}", environment="UAT (TripJack test environment)"))
        await s.commit()
asyncio.run(main())`;
  execSync("docker compose exec -T backend python -", { cwd: path.resolve(__dirname, "../../.."), input: code, stdio: ["pipe", "ignore", "inherit"] });
}

test.describe("TripJack log", () => {
  test("staff read what we sent TripJack and what it answered, and download the log", async ({ page, apiLog: _ }) => {
    const stamp = Date.now().toString(36);
    seed(stamp);
    await page.goto("/tripjack/log");
    await expect(page.getByRole("heading", { name: "TripJack log" })).toBeVisible();

    // Search finds the call by what TripJack answered.
    await page.getByLabel("Search").fill(`La Estoria ${stamp}`);
    await page.getByRole("button", { name: "Search" }).click();
    const row = page.locator("tr", { hasText: "/hms/v3/hotel/listing" }).first();
    await expect(row).toContainText("200");
    await row.click();

    const dialog = page.getByRole("dialog", { name: "TripJack call" });
    await expect(dialog).toContainText("POST https://apitest-hms.tripjack.com/hms/v3/hotel/listing");
    await expect(dialog).toContainText("UAT (TripJack test environment)");
    await expect(dialog.getByTestId("request-body")).toContainText(`"marker": "${stamp}"`);
    await expect(dialog.getByTestId("response-body")).toContainText(`La Estoria ${stamp}`);
    await expect(dialog).toContainText("apikey: …6789"); // never the key itself
    await dialog.getByRole("button", { name: "Close" }).click();

    // A failed call shows why.
    await page.getByLabel("Search").fill(`bad ${stamp}`);
    await page.getByLabel("Outcome").selectOption("failed");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.locator("tr", { hasText: "/fms/v1/air-search-all" })).toContainText("2001: bad");
    await page.getByLabel("Product").selectOption("hotels");
    await expect(page.getByText("No calls recorded yet.")).toBeVisible();
    await page.getByLabel("Product").selectOption("");

    // The text log for TripJack.
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download log (.txt)" }).click()]);
    expect(file.suggestedFilename()).toMatch(/^tripjack-log-.*\.txt$/);
  });
});

/** A flight search whose answer the log cut short, kept whole as the backend now keeps it. */
function seedLong(stamp: string) {
  const code = `
import asyncio, gzip, json
from app.db.session import SessionLocal
from app.modules.tripjack.models import TripJackLog
whole = json.dumps({"searchResult": {"tripInfos": {"ONWARD": [{"id": i} for i in range(400)]}}, "end": "last ${stamp}"})
async def main():
    async with SessionLocal() as s:
        s.add(TripJackLog(product="flights", method="POST", url="https://apitest.tripjack.com/fms/v1/air-search-all",
            path="/fms/v1/air-search-all", request_headers={"apikey": "…6789"}, request_body={"searchQuery": {}},
            status=200, response_body=whole[:200], response_bytes=len(whole), response_truncated=True,
            response_full=gzip.compress(whole.encode()), ms=900, ok=True, trace_id="long${stamp}",
            environment="UAT (TripJack test environment)"))
        await s.commit()
asyncio.run(main())`;
  execSync("docker compose exec -T backend python -", { cwd: path.resolve(__dirname, "../../.."), input: code, stdio: ["pipe", "ignore", "inherit"] });
}

test("a cut answer can be opened in full and downloaded", async ({ page, apiLog: _ }) => {
  const stamp = Date.now().toString(36);
  seedLong(stamp);
  await page.goto(`/tripjack/log?q=long${stamp}`);
  await page.locator("tr", { hasText: "/fms/v1/air-search-all" }).first().click();
  const dialog = page.getByRole("dialog", { name: "TripJack call" });
  await expect(dialog).toContainText("Cut short");
  await expect(dialog.getByTestId("response-body")).not.toContainText(`last ${stamp}`);

  await dialog.getByRole("button", { name: "Show full response" }).click();
  await expect(dialog.getByTestId("response-body")).toContainText(`"end": "last ${stamp}"`);
  await expect(dialog).toContainText("Showing the full response");

  const [file] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Download (.json)" }).click()]);
  expect(file.suggestedFilename()).toMatch(/^tripjack-flights-.*\.json$/);
});
