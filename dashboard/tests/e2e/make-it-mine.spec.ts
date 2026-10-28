import { execSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "../fixtures/test";

const psql = (sql: string) =>
  execSync("docker compose exec -T postgres psql -U wishtrip -d wishtrip -tA", {
    cwd: path.resolve(__dirname, "../../.."),
    input: sql,
  }).toString();

test.describe("Made their own", () => {
  test("staff see which itinerary a traveller made their own, and what they chose", async ({ page, apiLog: _ }) => {
    const stamp = Date.now().toString(36);
    const code = `e${stamp}`.slice(0, 12);
    const title = `E2E Slow Bali ${stamp}`;
    psql(
      `insert into traveller_trips (id, code, title, destination_name, source_share_code, creator_handle, adults, kids, seniors, days, pace, "group", items) values (gen_random_uuid(), '${code}', '${title}', 'Bali', 'e2e-src-${stamp}', 'e2ecreator', 2, 0, 0, 5, 'relaxed', 'couple', '[{"name":"Tanah Lot"}]'::jsonb)`,
    );
    try {
      await page.goto("/make-it-mine");
      await expect(page.getByRole("heading", { level: 1, name: "Made their own" })).toBeVisible();
      await expect(page.getByText("Most chosen itineraries")).toBeVisible();
      const row = page.getByRole("row").filter({ hasText: code.toUpperCase().slice(0, 4) }).filter({ hasText: title });
      await expect(row).toContainText("2 adults");
      await expect(row).toContainText("5 days · Relaxed · Couple");
      await expect(row).toContainText("@e2ecreator");
    } finally {
      psql(`delete from traveller_trips where code = '${code}'`);
    }
  });
});
