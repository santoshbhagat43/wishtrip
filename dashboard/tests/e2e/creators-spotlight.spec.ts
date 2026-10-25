import { execSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "../fixtures/test";
import { ADMIN, API_URL } from "../utils/env";

const DEV_CODE = process.env.CREATOR_DEV_OTP ?? "1234";

function seedReel(shortcode: string) {
  execSync(`docker compose exec -T backend python -m app.scripts.dev_reel ${shortcode}`, {
    cwd: path.resolve(__dirname, "../../.."),
    stdio: "ignore",
  });
}

test.describe("Creator spotlight", () => {
  test("staff choose the spotlight trip, one at a time", async ({ page, request, apiLog: _ }) => {
    const stamp = Date.now().toString(36);
    const staff = {
      Authorization: `Bearer ${(await (await request.post(`${API_URL}/auth/login`, { data: ADMIN })).json()).access_token}`,
    };
    // An approved creator with a handle and two published trips.
    const email = `e2e-spot-${stamp}@creators.example.com`;
    await request.post(`${API_URL}/auth/creator/request-otp`, { data: { email } });
    const token = (await (await request.post(`${API_URL}/auth/creator/verify`, { data: { email, code: DEV_CODE } })).json()).access_token;
    const creatorAuth = { Authorization: `Bearer ${token}` };
    const me = await (await request.get(`${API_URL}/creators/me`, { headers: creatorAuth })).json();
    await request.patch(`${API_URL}/creators/${me.id}`, {
      headers: staff,
      data: { status: "active", handle: `spot.${stamp}`, display_name: `Spot ${stamp}` },
    });
    for (const n of [1, 2]) {
      const code = `Csp${n}${stamp}`;
      seedReel(code);
      await request.post(`${API_URL}/creator/trips/import`, { headers: creatorAuth, data: { url: `https://www.instagram.com/reel/${code}/` } });
    }
    await expect
      .poll(async () => (await (await request.get(`${API_URL}/creator/trips`, { headers: creatorAuth })).json()).length, { timeout: 60_000 })
      .toBe(2);
    const mine = await (await request.get(`${API_URL}/creator/trips`, { headers: creatorAuth })).json();
    for (const [i, t] of mine.entries()) {
      await request.patch(`${API_URL}/creator/trips/${t.id}`, { headers: creatorAuth, data: { title: `Spot trip ${i + 1} ${stamp}`, publish: true } });
    }
    const [a, b] = mine as { id: string }[];

    await page.goto("/creators");
    const row = (id: string) => page.getByTestId(`spotlight-${id}`);
    await expect(page.getByRole("heading", { name: "Creator in the spotlight" })).toBeVisible();
    await expect(row(a.id)).toContainText(`@spot.${stamp}`);
    await expect(row(a.id)).toContainText("2 trips");

    await row(a.id).getByRole("button", { name: "Feature" }).click();
    await expect(row(a.id).getByText("In the spotlight")).toBeVisible();
    await expect(page.getByText("Featured now:")).toBeVisible();

    // Featuring another trip takes it from the first: one at a time.
    await row(b.id).getByRole("button", { name: "Feature" }).click();
    await expect(row(b.id).getByText("In the spotlight")).toBeVisible();
    await expect(row(a.id).getByText("In the spotlight")).toHaveCount(0);
    await expect(row(a.id).getByRole("button", { name: "Feature" })).toBeVisible();

    // The public page shows it.
    const index = await (await request.get(`${API_URL}/explore/creators`)).json();
    expect(index.spotlight_chosen).toBe(true);
    expect(index.spotlight.handle).toBe(`spot.${stamp}`);

    await row(b.id).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Nothing chosen.")).toBeVisible();
  });
});
