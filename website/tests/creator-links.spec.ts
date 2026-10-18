/**
 * A creator's reel links, end to end: make one before posting, use it, add the reel's Instagram
 * URL afterwards, and watch that link's own numbers move.
 *
 * Runs against the real stack. The creator is approved through the API first (staff do that in
 * the admin dashboard); everything else is the creator's own browser.
 */
import type { Page } from "@playwright/test";

import { API_URL, CREATOR_URL, SSO_URL, expect, test } from "./fixtures";

const DEV_CODE = process.env.CREATOR_DEV_OTP ?? "1234";
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "", password: process.env.ADMIN_PASSWORD ?? "" };
const SHOT = process.env.SHOT_DIR;

/** Sign a creator in through SSO, approve them as staff would, and land on the dashboard. */
async function approvedCreator(page: Page, request: import("@playwright/test").APIRequestContext) {
  const email = `e2e-links-${Date.now()}@creators.example.com`;
  await page.goto(`${CREATOR_URL}/creator`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Sign-in code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${CREATOR_URL}/creator`);

  const login = await request.post(`${API_URL}/auth/login`, { data: ADMIN });
  const headers = { Authorization: `Bearer ${(await login.json()).access_token}` };
  const creators = (await (await request.get(`${API_URL}/creators`, { headers })).json()) as {
    id: string;
    email: string;
    referral_code: string;
  }[];
  const me = creators.find((c) => c.email === email)!;
  await request.patch(`${API_URL}/creators/${me.id}`, {
    headers,
    // Handles are unique, so each run gets its own.
    data: {
      status: "active",
      display_name: "Meera Kamat",
      handle: `links.${Date.now().toString(36)}`,
      commission_per_user_paise: 5000,
    },
  });
  await page.reload();
  await expect(page.getByText("Approved creator").first()).toBeVisible();
  return me;
}

test.describe("Reel links", () => {
  test("a creator makes a link, uses it, then adds the reel — and sees that reel's numbers", async ({
    page,
    request,
    browser,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await approvedCreator(page, request);

    // The three steps sit beside the other tools; the Reels card has no reels yet.
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Reels", exact: true }) });
    await expect(page.getByText("How reel links work")).toBeVisible();
    await expect(section.getByText("No reels yet")).toBeVisible();

    // 1. "Create link" asks for a title; the link shows below once it's made.
    await section.getByRole("button", { name: "Create link" }).click();
    const dialog = page.getByRole("dialog", { name: "Create referral link" });
    await expect(dialog.getByText("appears here as soon as you create it")).toBeVisible();
    await dialog.getByLabel("Title").fill("Goa beach weekend");
    if (SHOT) await page.screenshot({ path: `${SHOT}/links-modal.png` });
    await dialog.getByRole("button", { name: "Create link" }).click();
    await expect(dialog.getByText("Your link is ready")).toBeVisible();
    const shortText = (await dialog.getByLabel("Your reel link").textContent())!.trim();
    expect(shortText).toMatch(/\/r\/[a-z]+-[a-z0-9]{4}$/);
    if (SHOT) await page.screenshot({ path: `${SHOT}/links-created.png` });
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);

    // 2. The reel is now a card, still waiting for its channel.
    const card = section.getByRole("button", { name: /Goa beach weekend/ });
    await expect(card).toContainText("Waiting for reel");
    if (SHOT) await page.screenshot({ path: `${SHOT}/links-card.png`, fullPage: true });

    // 3. A traveller opens the link from the reel (on the traveller site, as a stranger).
    const code = shortText.split("/r/")[1];
    const visitor = await browser.newContext();
    const visit = await visitor.request.get(`${process.env.WEBSITE_URL ?? "http://app.lvh.me:3002"}/r/${code}`, {
      maxRedirects: 0,
    });
    expect(visit.status()).toBe(307);
    expect(visit.headers()["location"]).toBe("/");
    const cookies = visit.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);
    expect(cookies.some((c) => c.startsWith("wishtrip_link=" + code))).toBe(true);
    await visitor.close();

    // 4. Open the card: link, numbers, and where it was posted.
    await page.reload();
    await section.getByRole("button", { name: /Goa beach weekend/ }).click();
    const reel = page.getByRole("dialog", { name: "Goa beach weekend" });
    await expect(reel.getByLabel("Your reel link")).toHaveText(shortText);
    await expect(reel.getByText("Visits").locator("xpath=..").getByText("1", { exact: true })).toBeVisible();

    // Neither Instagram nor YouTube → asked for one; nothing to publish yet.
    await expect(reel.getByRole("button", { name: "Publish" })).toBeDisabled();
    await reel.getByRole("button", { name: "Save" }).click();
    await expect(reel.getByText("one of them is needed")).toBeVisible();

    await reel.getByLabel("Instagram reel URL").fill("not an instagram link");
    await reel.getByRole("button", { name: "Save" }).click();
    await expect(reel.getByText(/Paste the link to your Instagram reel/)).toBeVisible();

    // A reel can only be on one link, so each run uses its own.
    const shortcode = `Ce2e${Date.now().toString(36)}`;
    await reel.getByLabel("Instagram reel URL").fill(`https://www.instagram.com/reel/${shortcode}/?igsh=xyz`);
    await reel.getByRole("button", { name: "Save" }).click();
    // The link is stored; the itinerary is built from it, step by step.
    await expect(reel.getByLabel("Instagram reel URL")).toHaveValue(`https://www.instagram.com/reel/${shortcode}/`);
    await expect(reel.getByRole("list", { name: "Building your itinerary" })).toBeVisible();
    await expect(section.getByRole("button", { name: /Goa beach weekend/ })).toContainText("Building itinerary");
    if (SHOT) await page.screenshot({ path: `${SHOT}/links-building.png` });
    await expect(reel.getByText("Your itinerary is ready")).toBeVisible({ timeout: 20_000 });
    if (SHOT) await page.screenshot({ path: `${SHOT}/links-ready.png` });

    // 5. Open the itinerary: one column a day, each stop traced back to the reel.
    await reel.getByRole("button", { name: "Open itinerary" }).click();
    const sheet = page.getByRole("dialog", { name: "Itinerary: Goa beach weekend" });
    await expect(sheet.getByText("DAY 1")).toBeVisible();
    await expect(sheet.getByText("DAY 3")).toBeVisible();
    await expect(sheet.getByText(/From the reel · 0:04/)).toBeVisible();
    await expect(sheet.getByText("Ready to publish")).toBeVisible();
    // The bookings that come with the board, and sharing it with family.
    await expect(sheet.getByText("BOOKINGS ON YOUR BOARD")).toBeVisible();
    await expect(sheet.getByText("FLIGHTS")).toBeVisible();
    await expect(sheet.getByText("STAY", { exact: true })).toBeVisible();
    await expect(sheet.getByText("TRANSFERS")).toBeVisible();
    await sheet.getByRole("button", { name: "Share with family" }).click();
    const share = sheet.getByRole("group", { name: "Share with family" });
    await expect(share.getByText("Publish the itinerary first")).toBeVisible();
    await expect(share.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
    if (SHOT) await page.screenshot({ path: `${SHOT}/links-share.png` });
    await sheet.getByRole("button", { name: "Share with family" }).click();
    await expect(share).toHaveCount(0);
    if (SHOT) await page.screenshot({ path: `${SHOT}/links-itinerary.png`, fullPage: true });

    // 6. Only the creator publishes (unless they chose auto), and can take it back.
    await sheet.getByRole("button", { name: "Publish itinerary" }).click();
    await expect(sheet.getByText("Share this link")).toBeVisible();
    if (SHOT) await page.screenshot({ path: `${SHOT}/links-published.png`, fullPage: true });
    await sheet.getByRole("button", { name: "Unpublish" }).click();
    await expect(sheet.getByText("Share this link")).toHaveCount(0);
    await sheet.getByRole("button", { name: "Back to reel" }).click();
    await expect(sheet).toHaveCount(0);
    await reel.getByRole("button", { name: "Close" }).click();
    await expect(card).toContainText("Ready to publish");

    expect(pageErrors).toEqual([]);
  });

  test("a reel posted only on YouTube is enough", async ({ page, request }) => {
    await approvedCreator(page, request);
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Reels", exact: true }) });
    await section.getByRole("button", { name: "Create link" }).click();
    const dialog = page.getByRole("dialog", { name: "Create referral link" });
    await dialog.getByLabel("Title").fill("Hampi in a day");
    await dialog.getByRole("button", { name: "Create link" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();

    await section.getByRole("button", { name: /Hampi in a day/ }).click();
    const reel = page.getByRole("dialog", { name: "Hampi in a day" });
    await reel.getByLabel("YouTube video URL").fill("https://example.com/not-youtube");
    await reel.getByRole("button", { name: "Save" }).click();
    await expect(reel.getByText(/Paste the link to your YouTube video/)).toBeVisible();
    await reel.getByLabel("YouTube video URL").fill("https://www.youtube.com/watch?v=abc123");
    await reel.getByLabel("Publish it automatically once the itinerary is built").check();
    await reel.getByRole("button", { name: "Save and build itinerary" }).click();
    await expect(reel.getByText("Your itinerary is ready")).toBeVisible({ timeout: 20_000 });
    // Auto-publish: nobody had to press Publish.
    await expect(reel.getByText("This reel is published.")).toBeVisible();
    await reel.getByRole("button", { name: "Close" }).click();
    await expect(section.getByRole("button", { name: /Hampi in a day/ })).toContainText("Published");
  });

  test("the overall link is shown in full, with a copy button", async ({ page, request }) => {
    const me = await approvedCreator(page, request);
    const card = page.locator("section").filter({ hasText: "Your overall link" });
    const link = card.getByLabel("Your overall referral link");
    await expect(link).toHaveText(new RegExp(`/c/${me.referral_code}$`));
    // Not clipped: its text is wholly on screen.
    const box = (await link.boundingBox())!;
    const parent = (await card.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(parent.x + parent.width + 1);
    await expect(card.getByRole("button", { name: "Copy link" })).toBeVisible();
  });

  test("a creator who isn't approved yet sees why they can't make links", async ({ page }) => {
    const email = `e2e-pendinglinks-${Date.now()}@creators.example.com`;
    await page.goto(`${CREATOR_URL}/creator`);
    await expect(page).toHaveURL(new RegExp(`^${SSO_URL}/sso/login`));
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByLabel("Sign-in code").fill(DEV_CODE);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${CREATOR_URL}/creator`);

    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Reels", exact: true }) });
    await expect(section.getByText("unlock as soon as the WishTrip team approves")).toBeVisible();
    await expect(section.getByRole("button", { name: "Create link" })).toHaveCount(0);
  });

  test("an unknown reel link just opens the home page", async ({ request }) => {
    const res = await request.get(`/r/nope-0000`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toBe("/");
  });
});
