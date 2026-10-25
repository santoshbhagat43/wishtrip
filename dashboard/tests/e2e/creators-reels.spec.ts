/**
 * Staff add reels for a creator from the dashboard (/creators/<id>) the way the creator does on
 * their own dashboard: make a link, add the reel, get the itinerary, publish. The work is done in
 * the creator's workspace, so they see it too.
 */
import { execSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "../fixtures/test";
import { ADMIN, API_URL } from "../utils/env";

const DEV_CODE = process.env.CREATOR_DEV_OTP ?? "1234";
const SHOT = process.env.SHOT_DIR;

function seedReel(shortcode: string) {
  execSync(`docker compose exec -T backend python -m app.scripts.dev_reel ${shortcode}`, {
    cwd: path.resolve(__dirname, "../../.."),
    stdio: "ignore",
  });
}

/** An approved creator who has signed in once (so they have an account), set up through the API. */
async function creatorWhoSignedIn(request: import("@playwright/test").APIRequestContext, label: string) {
  const stamp = Date.now().toString(36);
  const staff = {
    Authorization: `Bearer ${(await (await request.post(`${API_URL}/auth/login`, { data: ADMIN })).json()).access_token}`,
  };
  const email = `e2e-staffreel-${label}-${stamp}@creators.example.com`;
  await request.post(`${API_URL}/auth/creator/request-otp`, { data: { email } });
  const token = (await (await request.post(`${API_URL}/auth/creator/verify`, { data: { email, code: DEV_CODE } })).json()).access_token;
  const asCreator = { Authorization: `Bearer ${token}` };
  const me = await (await request.get(`${API_URL}/creators/me`, { headers: asCreator })).json();
  await request.patch(`${API_URL}/creators/${me.id}`, {
    headers: staff,
    data: { status: "active", handle: `staff.${label}.${stamp}`, display_name: `Staff ${label}` },
  });
  return { id: me.id as string, asCreator, stamp };
}

test.describe("Reels added by staff", () => {
  test("make a link, add the reel, open the itinerary and publish it, as the creator would", async ({ page, request, apiLog: _ }) => {
    const c = await creatorWhoSignedIn(request, "link");
    const code = `Cst${c.stamp}`;
    seedReel(code);

    await page.goto(`/creators/${c.id}`);
    await expect(page.getByRole("heading", { name: "Reel links and itineraries" })).toBeVisible();
    await expect(page.getByText(/What you add appears in their own dashboard, and is recorded as done by staff/)).toBeVisible();

    await page.getByRole("button", { name: "Create link" }).click();
    const dialog = page.getByRole("dialog", { name: "Create referral link" });
    await dialog.getByLabel("Title").fill("Goa beach weekend");
    await dialog.getByRole("button", { name: "Create link" }).click();
    await expect(dialog.getByText("Your link is ready")).toBeVisible();
    await expect(dialog.getByLabel("Your reel link")).toContainText("/r/");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);

    const card = page.getByRole("button", { name: /Goa beach weekend/ });
    await expect(card).toContainText("Waiting for reel");
    await card.click();
    const reel = page.getByRole("dialog", { name: "Goa beach weekend" });
    await reel.getByLabel("Instagram reel URL").fill(`https://www.instagram.com/reel/${code}/?igsh=xyz`);
    await reel.getByRole("button", { name: "Save as draft" }).click();
    await expect(reel.getByText("Your itinerary is ready")).toBeVisible({ timeout: 60_000 });
    if (SHOT) await page.screenshot({ path: `${SHOT}/staff-reel-modal.png` });

    await reel.getByRole("button", { name: "Open itinerary" }).click();
    const sheet = page.getByRole("dialog", { name: "Itinerary: Goa beach weekend" });
    await expect(sheet.getByRole("tab", { name: /Day 1/ })).toBeVisible();
    await expect(sheet.getByText("Fort Aguada", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Not published")).toBeVisible();
    await sheet.getByRole("button", { name: "Publish itinerary" }).click();
    await expect(sheet.getByText("Share this link")).toBeVisible();
    if (SHOT) await page.screenshot({ path: `${SHOT}/staff-itinerary.png` });

    // It is the creator's: they see the same link, published, in their own workspace.
    const mine = await (await request.get(`${API_URL}/creator/links`, { headers: c.asCreator })).json();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ label: "Goa beach weekend", status: "published" });
    const trips = await (await request.get(`${API_URL}/creator/trips`, { headers: c.asCreator })).json();
    expect(trips).toHaveLength(1);
    expect(trips[0].items.map((i: { name: string }) => i.name)).toContain("Fort Aguada");

    // Closing the itinerary returns to the reel, as it does for the creator.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(reel).toBeVisible();
    await reel.getByRole("button", { name: "Close" }).click();
    await expect(reel).toHaveCount(0);
    if (SHOT) await page.screenshot({ path: `${SHOT}/staff-creator-page.png`, fullPage: true });

    // Pick a cover for it, as the creator could.
    // The card opens the itinerary itself.
    await page.getByRole("button", { name: /Goa beach weekend/ }).click();
    await sheet.getByRole("button", { name: "Change cover" }).click();
    await expect(page.getByRole("dialog", { name: "Choose a cover image" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("a video staff upload is read into an itinerary for the creator", async ({ page, request, apiLog: _ }) => {
    const c = await creatorWhoSignedIn(request, "video");
    await page.goto(`/creators/${c.id}`);
    await page.getByRole("button", { name: "Create link" }).click();
    const dialog = page.getByRole("dialog", { name: "Create referral link" });
    await dialog.getByLabel("Title").fill("Bali in four days");
    await dialog.getByRole("button", { name: "Create link" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();

    await page.getByRole("button", { name: /Bali in four days/ }).click();
    const reel = page.getByRole("dialog", { name: "Bali in four days" });
    await reel.getByLabel("Upload a video file").setInputFiles(path.resolve(__dirname, "../../../website/tests/fixtures/bali-reel.mp4"));
    await expect(reel.getByText("Your itinerary is ready")).toBeVisible({ timeout: 200_000 });

    const trips = await (await request.get(`${API_URL}/creator/trips`, { headers: c.asCreator })).json();
    expect(trips).toHaveLength(1);
    expect(trips[0].items.length).toBeGreaterThan(3);
  });

  test("a creator who is not approved yet, or who has never signed in, can't have reels added", async ({ page, request, apiLog: _ }) => {
    const stamp = Date.now().toString(36);
    const email = `e2e-staffreel-wait-${stamp}@creators.example.com`;
    await request.post(`${API_URL}/auth/creator/request-otp`, { data: { email } });
    const token = (await (await request.post(`${API_URL}/auth/creator/verify`, { data: { email, code: DEV_CODE } })).json()).access_token;
    const me = await (await request.get(`${API_URL}/creators/me`, { headers: { Authorization: `Bearer ${token}` } })).json();

    await page.goto(`/creators/${me.id}`);
    await expect(page.getByText("Reels can be added once this creator is approved.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create link" })).toHaveCount(0);
  });
});
