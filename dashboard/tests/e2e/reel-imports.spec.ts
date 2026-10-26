import { execSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "../fixtures/test";

const psql = (sql: string) =>
  execSync("docker compose exec -T postgres psql -U wishtrip -d wishtrip -tA", {
    cwd: path.resolve(__dirname, "../../.."),
    input: sql,
  }).toString();

test.describe("Reel imports", () => {
  test("staff see each import's stage timings, log and text read", async ({ page, apiLog: _ }) => {
    const code = `e2e${Date.now().toString(36)}`;
    const t0 = Date.now() - 90_000;
    const at = (s: number) => new Date(t0 + s * 1000).toISOString();
    const log = JSON.stringify([
      { at: at(1), step: "started", message: "Picked up by a worker" },
      { at: at(2), step: "downloading" },
      { at: at(12), step: "reading_screen" },
      { at: at(20), message: "Screen: 40 frames, 18 lines of text read", seconds: 31.5 },
      { at: at(40), message: "Voice-over: 120 words in en", seconds: 25.2 },
      { at: at(55), step: "finding_places" },
    ]).replace(/'/g, "''");
    const id = psql(
      `insert into reel_imports (id, url, shortcode, user_id, kind, status, step, error, log, created_at, updated_at, finished_at) select gen_random_uuid(), 'https://www.instagram.com/reel/${code}/', '${code}', id, 'creator_trip', 'done', 'done', '', '${log}'::jsonb, '${at(0)}', now(), '${at(75)}' from users where role = 'admin' limit 1 returning id`,
    )
      .split("\n")[0]
      .trim();
    try {
      await page.goto("/reels");
      await expect(page.getByRole("heading", { level: 1, name: "Reel imports" })).toBeVisible();
      const row = page.getByRole("row").filter({ hasText: code });
      await expect(row).toContainText("done");
      await expect(row).toContainText("10.0 s"); // downloading
      await expect(row).toContainText("1 min 15 s"); // total

      await row.getByRole("link").first().click();
      await expect(page).toHaveURL(new RegExp(`/reels/${id}$`));
      await expect(page.getByText("Screen: 40 frames, 18 lines of text read")).toBeVisible();
      await expect(page.getByText("Voice-over: 120 words in en")).toBeVisible();
      await expect(page.getByText("Time per stage")).toBeVisible();
    } finally {
      psql(`delete from reel_imports where id = '${id}'`);
    }
  });
});
