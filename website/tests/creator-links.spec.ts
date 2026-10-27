/**
 * A creator's reel links, end to end: make one before posting, use it, add the reel's Instagram
 * URL afterwards, and watch that link's own numbers move.
 *
 * Runs against the real stack. The creator is approved through the API first (staff do that in
 * the admin dashboard); everything else is the creator's own browser.
 */
import { execSync } from "node:child_process";
import path from "node:path";

import type { Page } from "@playwright/test";

import { API_URL, CREATOR_URL, SSO_URL, expect, test } from "./fixtures";

const DEV_CODE = process.env.CREATOR_DEV_OTP ?? "1234";
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "", password: process.env.ADMIN_PASSWORD ?? "" };
const SHOT = process.env.SHOT_DIR;
const WEBSITE = process.env.WEBSITE_URL ?? "http://app.lvh.me:3002";

/** A reel that has already been read, so the itinerary can be built without Instagram. */
function seedReel(shortcode: string) {
  execSync(`docker compose exec -T backend python -m app.scripts.dev_reel ${shortcode}`, {
    cwd: path.resolve(__dirname, "../.."),
    stdio: "ignore",
  });
}

/** Sign a creator in through SSO, approve them as staff would, and land on the dashboard. */
async function approvedCreator(page: Page, request: import("@playwright/test").APIRequestContext) {
  const email = `e2e-links-${Date.now()}@creators.example.com`;
  await page.goto(`${CREATOR_URL}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Sign-in code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${CREATOR_URL}/`);

  const login = await request.post(`${API_URL}/auth/login`, { data: ADMIN });
  const headers = { Authorization: `Bearer ${(await login.json()).access_token}` };
  const found = (await (await request.get(`${API_URL}/creators`, { headers, params: { q: email } })).json()) as {
    items: { id: string; email: string; referral_code: string }[];
  };
  const me = found.items.find((c) => c.email === email)!;
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

/** The itinerary shows one day at a time: open the first day that has this stop. */
async function openDayWith(sheet: import("@playwright/test").Locator, what: string | RegExp) {
  for (const tab of await sheet.getByRole("tab").all()) {
    await tab.click();
    if (await sheet.getByText(what, typeof what === "string" ? { exact: true } : {}).count()) return;
  }
  throw new Error(`No day has ${what}`);
}

test.describe("Reel links", () => {
  test("a creator makes a link, adds the reel, gets an itinerary, and publishes it", async ({
    page,
    request,
    browser,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await approvedCreator(page, request);

    // The how-it-works steps are hidden for now; the Reels card has no reels yet.
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Reels", exact: true }) });
    await expect(page.getByText("How reel links work")).toHaveCount(0);
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
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);

    // 2. The reel is now a card, still waiting for its channel.
    const card = section.getByRole("button", { name: /Goa beach weekend/ });
    await expect(card).toContainText("Waiting for reel");

    // 3. A traveller opens the link from the reel: nothing is published, so home page.
    const code = shortText.split("/r/")[1];
    const visitor = await browser.newContext();
    const visit = await visitor.request.get(`${WEBSITE}/r/${code}`, { maxRedirects: 0 });
    expect(visit.status()).toBe(307);
    expect(visit.headers()["location"]).toBe("/");
    const cookies = visit.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);
    expect(cookies.some((c) => c.startsWith("wishtrip_link=" + code))).toBe(true);

    // 4. Open the card: link, numbers, and where it was posted.
    await page.reload();
    await section.getByRole("button", { name: /Goa beach weekend/ }).click();
    const reel = page.getByRole("dialog", { name: "Goa beach weekend" });
    await expect(reel.getByLabel("Your reel link")).toHaveText(shortText);
    await expect(reel.getByText("Visits").locator("xpath=..").getByText("1", { exact: true })).toBeVisible();

    // Neither Instagram nor YouTube → asked for one; nothing to publish yet.
    await expect(reel.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
    await reel.getByRole("button", { name: "Save as draft" }).click();
    await expect(reel.getByText("one of them is needed")).toBeVisible();
    await reel.getByLabel("Instagram reel URL").fill("not an instagram link");
    await reel.getByRole("button", { name: "Save and publish" }).click();
    await expect(reel.getByText(/Paste the link to your Instagram reel/)).toBeVisible();

    // A real reel link: the server downloads it, reads it and builds the itinerary.
    // (Here the reel is already in the cache, so Instagram isn't needed.)
    const shortcode = `Ce2e${Date.now().toString(36)}`;
    seedReel(shortcode);
    await reel.getByLabel("Instagram reel URL").fill(`https://www.instagram.com/reel/${shortcode}/?igsh=xyz`);
    if (SHOT) await page.screenshot({ path: `${SHOT}/links-form.png` });
    await reel.getByRole("button", { name: "Save as draft" }).click();
    await expect(reel.getByLabel("Instagram reel URL")).toHaveValue(`https://www.instagram.com/reel/${shortcode}/`);
    await expect(reel.getByText("Your itinerary is ready")).toBeVisible({ timeout: 60_000 });
    await expect(reel.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
    // A picture from the reel: on the card behind its title.
    await expect(card.locator("img")).toBeVisible();
    await expect.poll(() => card.locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    if (SHOT) await page.screenshot({ path: `${SHOT}/links-ready.png` });

    // 5. Open the itinerary: the stops that were read, in days, each traced back to the reel.
    await reel.getByRole("button", { name: "Open itinerary" }).click();
    const sheet = page.getByRole("dialog", { name: "Itinerary: Goa beach weekend" });
    await expect(sheet.getByRole("tab", { name: /Day 1/ })).toBeVisible();
    // The itinerary has its own address, /<itinerary id>: it survives a reload, and
    // Back returns to the reel it was opened from.
    await expect(page).toHaveURL(new RegExp(`^${CREATOR_URL}/[0-9a-f-]{36}$`));
    await page.reload();
    await expect(sheet.getByRole("tab", { name: /Day 1/ })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`${CREATOR_URL}/`);
    await expect(sheet).toHaveCount(0);
    await page.goForward();
    await expect(sheet.getByRole("tab", { name: /Day 1/ })).toBeVisible();
    await expect(sheet.getByText("From your reel", { exact: true })).toBeVisible();
    await openDayWith(sheet, "Fort Aguada");
    await expect(sheet.getByText("Fort Aguada", { exact: true })).toBeVisible();
    await openDayWith(sheet, "Old Goa churches");
    await expect(sheet.getByText("Old Goa churches", { exact: true })).toBeVisible();
    await openDayWith(sheet, /From the reel · 0:04/);
    await expect(sheet.getByText(/From the reel · 0:04/)).toBeVisible();
    await sheet.getByRole("tab", { name: /Day 1/ }).click();
    await expect(sheet.getByText("Not published")).toBeVisible();
    // A creator doesn't see sample bookings: that strip is for travellers.
    await expect(sheet.getByText("BOOKINGS ON YOUR BOARD")).toHaveCount(0);
    await expect(page.getByText(/bookings below are samples/i)).toHaveCount(0);
    // …and can share it with family.
    await sheet.getByRole("button", { name: "Share with family" }).click();
    const share = sheet.getByRole("group", { name: "Share with family" });
    await expect(share.getByText("Publish the itinerary first")).toBeVisible();
    await sheet.getByRole("button", { name: "Share with family" }).click();
    if (SHOT) await page.screenshot({ path: `${SHOT}/links-itinerary.png`, fullPage: true });

    // 6. Only the creator publishes; then the reel link opens the itinerary.
    await sheet.getByRole("button", { name: "Publish itinerary" }).click();
    await expect(sheet.getByText("Share this link")).toBeVisible();
    const shared = (await sheet.locator("code").filter({ hasText: "/t/" }).first().textContent())!.trim();
    expect(shared).toMatch(/\/t\/[a-z0-9-]+$/);
    await sheet.getByRole("button", { name: "Share with family" }).click();
    await expect(share.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
    await sheet.getByRole("button", { name: "Share with family" }).click();
    if (SHOT) await page.screenshot({ path: `${SHOT}/links-published.png`, fullPage: true });

    const published = await visitor.request.get(`${WEBSITE}/r/${code}`, { maxRedirects: 0 });
    expect(published.headers()["location"]).toBe(`/t/${shared.split("/t/")[1]}`);
    // …and that page is the creator's itinerary, open to anyone.
    const traveller = await visitor.newPage();
    await traveller.goto(`${WEBSITE}/r/${code}`);
    await expect(traveller).toHaveURL(new RegExp(`/t/${shared.split("/t/")[1]}$`));
    // The trip board, as in the B4 prototype: nothing missing.
    await expect(traveller.getByText("Fort Aguada").first()).toBeVisible();
    await expect(traveller.getByRole("heading", { level: 1 })).toHaveText("Goa trip");
    await expect(traveller.getByText(/^A trip by /)).toBeVisible();
    await expect(traveller.getByRole("button", { name: "Share with family" })).toBeVisible();
    await expect(traveller.getByText("BOOKINGS ON YOUR BOARD")).toBeVisible();
    for (const kind of ["FLIGHTS", "STAY", "TRANSFERS"]) await expect(traveller.getByText(kind, { exact: true })).toBeVisible();
    await expect(traveller.getByText("DAY BY DAY")).toBeVisible();
    await expect(traveller.getByText("DAY 1", { exact: true })).toBeVisible();
    await expect(traveller.getByText(/From the reel · 0:04/)).toBeVisible();
    await expect(traveller.getByRole("tab", { name: /Day 2/ })).toBeVisible(); // the days are tabs
    await traveller.getByRole("tab", { name: /Day 2/ }).click();
    await expect(traveller.getByText("DAY 2", { exact: true })).toBeVisible();
    await traveller.getByRole("tab", { name: /Day 1/ }).click();
    await expect(traveller.getByText("ONE PRICE, EVERYTHING IN")).toBeVisible();
    await expect(traveller.getByText("Total for 3")).toBeVisible();
    await expect(traveller.getByRole("link", { name: "Make it mine" })).toBeVisible();
    // They came straight to a trip: no booking-flow steps above it.
    await expect(traveller.getByRole("list", { name: "Progress" })).toHaveCount(0);
    await expect(traveller.getByRole("navigation", { name: "Progress" })).toHaveCount(0);
    await expect(traveller.getByText("Shape your board")).toHaveCount(0);
    await expect(traveller.getByText("Nothing is charged until you choose at checkout")).toBeVisible();
    await expect(traveller.getByText("Change anything with Arya")).toBeVisible();
    await expect(traveller.getByRole("link", { name: "Add a sunset cruise" })).toBeVisible();
    await expect(traveller.locator("main img").first()).toBeVisible(); // the reel's picture
    await traveller.getByRole("button", { name: "Share with family" }).click();
    await expect(traveller.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
    await traveller.getByRole("button", { name: "Share with family" }).click();
    if (SHOT) await traveller.screenshot({ path: `${SHOT}/shared-trip.png`, fullPage: true });

    // "Make it mine": the Details screen asks who is coming, then the trip is shaped around them.
    await traveller.getByRole("link", { name: "Make it mine" }).click();
    await expect(traveller).toHaveURL(/\/trip\/details\?trip=/);
    await expect(traveller.getByRole("heading", { level: 1, name: "Your Goa trip" })).toBeVisible();
    await expect(traveller.getByText(/’S TRIP$/).last()).toBeVisible();
    await traveller.getByRole("button", { name: "More Children" }).click();
    await traveller.getByRole("button", { name: "More Children" }).click();
    await traveller.getByRole("button", { name: "Fewer days" }).click();
    // The estimate for who's going is on the Details screen (a sample until bookings are live).
    await expect(traveller.getByText("ESTIMATE FOR 4 TRAVELLERS").last()).toBeVisible();
    await traveller.getByRole("button", { name: "Build my trip →" }).click();

    // The trip gets its own number, in the address.
    await expect(traveller).toHaveURL(/\/trip\/mine\/[a-z0-9]{8}$/);
    const tripNo = traveller.url().split("/").pop()!;
    await expect(traveller.getByText(/^Made for you · based on /)).toBeVisible();
    await expect(traveller.getByRole("heading", { level: 1 })).toHaveText("Your Goa trip");
    await expect(traveller.locator("main").getByText(/^1 day · \d+ stops/)).toBeVisible();
    await expect(traveller.getByText("2 adults, 2 children")).toBeVisible();
    await expect(traveller.getByText("Total for 4")).toBeVisible();
    await expect(traveller.getByText(`${tripNo.slice(0, 4)}-${tripNo.slice(4)}`.toUpperCase())).toBeVisible();
    await expect(traveller.getByRole("link", { name: "Book in one go" })).toBeVisible();
    await expect(traveller.getByText("Fort Aguada").first()).toBeVisible(); // still the creator's stops

    // Coming back to the number brings back the same trip, and Change details has the same answers.
    await traveller.goto(`${WEBSITE}/trip/mine/${tripNo}`);
    await expect(traveller.getByText("2 adults, 2 children")).toBeVisible();
    await traveller.getByRole("link", { name: "Change details" }).click();
    await expect(traveller).toHaveURL(/\/trip\/details\?trip=.*&mine=/);
    await expect(traveller.getByText("ESTIMATE FOR 4 TRAVELLERS").last()).toBeVisible();
    await expect(traveller.getByText("1 days").last()).toBeVisible();
    await traveller.getByRole("button", { name: "More days" }).click();
    await traveller.getByRole("button", { name: "Build my trip →" }).click();
    await expect(traveller).toHaveURL(new RegExp(`/trip/mine/${tripNo}$`)); // same number
    await expect(traveller.locator("main").getByText(/^2 days · \d+ stops/)).toBeVisible();

    await traveller.goto(`${WEBSITE}/trip/mine/zzzzzzzz`);
    await expect(traveller.getByText("We couldn’t find that trip")).toBeVisible();
    await traveller.close();

    // 7. They can take it back: the link goes back to the home page.
    await sheet.getByRole("button", { name: "Unpublish" }).click();
    await expect(sheet.getByText("Share this link")).toHaveCount(0);
    await expect
      .poll(async () => (await visitor.request.get(`${WEBSITE}/r/${code}`, { maxRedirects: 0 })).headers()["location"])
      .toBe("/");
    await visitor.close();
    await sheet.getByRole("button", { name: "Back to reel" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`^${CREATOR_URL}/\\?reel=`));
    await reel.getByRole("button", { name: "Close" }).click();
    await expect(page).toHaveURL(`${CREATOR_URL}/`);
    await expect(card).toContainText("Not published");

    expect(pageErrors).toEqual([]);
  });

  test("with auto-publish, nobody has to press Publish", async ({ page, request }) => {
    await approvedCreator(page, request);
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Reels", exact: true }) });
    await section.getByRole("button", { name: "Create link" }).click();
    const dialog = page.getByRole("dialog", { name: "Create referral link" });
    await dialog.getByLabel("Title").fill("Hampi in a day");
    await dialog.getByRole("button", { name: "Create link" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();

    await section.getByRole("button", { name: /Hampi in a day/ }).click();
    const reel = page.getByRole("dialog", { name: "Hampi in a day" });
    const shortcode = `Cauto${Date.now().toString(36)}`;
    seedReel(shortcode);
    await reel.getByLabel("Instagram reel URL").fill(`instagram.com/reel/${shortcode}/`);
    await reel.getByRole("button", { name: "Save and publish" }).click();
    await expect(reel.getByText("This reel is published.")).toBeVisible({ timeout: 60_000 });
    await reel.getByRole("button", { name: "Close" }).click();
    await expect(section.getByRole("button", { name: /Hampi in a day/ })).toContainText("Published");
  });

  test("a YouTube video is read into an itinerary like a reel", async ({ page, request }) => {
    await approvedCreator(page, request);
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Reels", exact: true }) });
    await section.getByRole("button", { name: "Create link" }).click();
    const dialog = page.getByRole("dialog", { name: "Create referral link" });
    await dialog.getByLabel("Title").fill("Coorg monsoon");
    await dialog.getByRole("button", { name: "Create link" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();

    await section.getByRole("button", { name: /Coorg monsoon/ }).click();
    const reel = page.getByRole("dialog", { name: "Coorg monsoon" });

    // A channel link instead of a video is refused.
    await reel.getByLabel("YouTube video URL").fill("https://www.youtube.com/@somechannel");
    await reel.getByRole("button", { name: "Save as draft" }).click();
    await expect(reel.getByText(/Paste the link to your YouTube video/)).toBeVisible();

    // A video link is downloaded and read just like a reel. (Here the video is already in the
    // cache, so YouTube isn't needed.)
    const id = `E2E${Date.now().toString(36).padEnd(8, "x")}`.slice(0, 11);
    seedReel(`yt-${id}`);
    await reel.getByLabel("YouTube video URL").fill(`https://youtu.be/${id}?si=tracking`);
    await reel.getByRole("button", { name: "Save as draft" }).click();
    await expect(reel.getByLabel("YouTube video URL")).toHaveValue(`https://www.youtube.com/watch?v=${id}`);
    await expect(reel.getByText("Your itinerary is ready")).toBeVisible({ timeout: 60_000 });
    await reel.getByRole("button", { name: "Open itinerary" }).click();
    const sheet = page.getByRole("dialog", { name: "Itinerary: Coorg monsoon" });
    await expect(sheet.getByText("Fort Aguada", { exact: true })).toBeVisible();
    await expect(sheet.getByText("YouTube", { exact: true })).toBeVisible(); // made from
  });

  test("a video uploaded instead of a link is read for real into an itinerary", async ({ page, request }) => {
    // The real chain, nothing cached: the worker cuts the video into frames, reads the text on
    // them, listens to the voice-over, finds the places and builds the itinerary.
    test.setTimeout(240_000);
    await approvedCreator(page, request);
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Reels", exact: true }) });
    await section.getByRole("button", { name: "Create link" }).click();
    const dialog = page.getByRole("dialog", { name: "Create referral link" });
    await dialog.getByLabel("Title").fill("Bali in four days");
    await dialog.getByRole("button", { name: "Create link" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();

    await section.getByRole("button", { name: /Bali in four days/ }).click();
    const reel = page.getByRole("dialog", { name: "Bali in four days" });
    await expect(reel.getByText(/Can't use a link\? Upload the video file/)).toBeVisible();
    await reel.getByLabel("Upload a video file").setInputFiles(path.resolve(__dirname, "fixtures/bali-reel.mp4"));
    await expect(reel.getByText("Your itinerary is ready")).toBeVisible({ timeout: 200_000 });

    await reel.getByRole("button", { name: "Open itinerary" }).click();
    const sheet = page.getByRole("dialog", { name: "Itinerary: Bali in four days" });
    await expect(sheet.getByRole("tab", { name: /Day 1/ })).toBeVisible();
    // What the video says out loud and shows on screen: the places, and where on screen they showed.
    await openDayWith(sheet, /Uluwatu/);
    await expect(sheet.getByText(/Uluwatu/).first()).toBeVisible();
    await openDayWith(sheet, /From the reel · \d+:\d\d/);
    await expect(sheet.getByText(/From the reel · \d+:\d\d/).first()).toBeVisible();
    // The video names five places and says "4 days": those five show straight away, and the
    // itinerary is made whole in the background, saying which stops are the video's and which
    // were added.
    await expect(sheet.getByRole("tab", { name: /Day 4/ })).toBeVisible({ timeout: 120_000 });
    await expect(sheet.getByText(/We.re adding suggestions/)).toHaveCount(0);
    await openDayWith(sheet, "Wishtrip recommended");
    await expect(sheet.getByText("Wishtrip recommended").first()).toBeVisible();
    if (SHOT) await page.screenshot({ path: `${SHOT}/links-upload.png`, fullPage: true });

    // Choose the cover from frames of the uploaded video.
    const hero = sheet.locator("img").first();
    const before = await hero.getAttribute("src");
    await sheet.getByRole("button", { name: "Change cover" }).click();
    const picker = page.getByRole("dialog", { name: "Choose a cover image" });
    await expect(picker.getByText(/^At \d+:\d\d$/).first()).toBeVisible();
    expect(await picker.getByText(/^At \d+:\d\d$/).count()).toBeGreaterThan(1);
    if (SHOT) await page.screenshot({ path: `${SHOT}/cover-picker.png` });
    await picker.locator('button[aria-pressed="false"]').first().click();
    await expect(picker).toHaveCount(0);
    await expect.poll(async () => hero.getAttribute("src")).not.toBe(before);

    // The reel's thumbnail is a separate image: choosing it leaves the banner alone.
    const banner = await hero.getAttribute("src");
    await sheet.getByRole("button", { name: "Change thumbnail" }).click();
    const thumbs = page.getByRole("dialog", { name: "Choose a reel thumbnail" });
    await expect(thumbs.getByText(/tall 3:4 card/)).toBeVisible();
    await expect(thumbs.locator('button[aria-pressed="true"]')).toHaveCount(1);
    await thumbs.locator('button[aria-pressed="false"]').first().click();
    await expect(thumbs).toHaveCount(0);
    expect(await hero.getAttribute("src")).toBe(banner);
    await sheet.getByRole("button", { name: "Change thumbnail" }).click();
    await expect(page.getByRole("dialog", { name: "Choose a reel thumbnail" }).locator('button[aria-pressed="true"]')).toHaveCount(1);
    await page.getByRole("dialog", { name: "Choose a reel thumbnail" }).getByRole("button", { name: "Close" }).click();

    // The trip editor: same cover, the stops by day, and edits that save.
    const tripId = page.url().match(/\/([0-9a-f-]{36})$/)![1];
    await page.goto(`${CREATOR_URL}/trips/${tripId}`);
    await expect(page.getByText("Edit your trip")).toBeVisible();
    await expect(page.getByRole("region", { name: "Day 1" })).toBeVisible();
    await expect(page.getByText("All changes saved")).toBeVisible();
    await page.getByLabel("Title").fill("Bali, my way");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("All changes saved")).toBeVisible();
    await page.getByRole("button", { name: "Change cover" }).click();
    await expect(page.getByRole("dialog", { name: "Choose a cover image" })).toBeVisible();
    if (SHOT) await page.screenshot({ path: `${SHOT}/editor-cover.png` });
    await page.keyboard.press("Escape");
    if (SHOT) await page.screenshot({ path: `${SHOT}/editor.png`, fullPage: true });
  });

  test("a busy link's activity is paged, not one long list", async ({ page, request }) => {
    const me = await approvedCreator(page, request);
    const activity = page.locator("section").filter({ has: page.getByRole("heading", { name: "Activity", exact: true }) });
    await expect(activity.getByText("No activity yet")).toBeVisible();
    await expect(activity.getByRole("navigation", { name: "Activity pages" })).toHaveCount(0);

    // Twenty travellers open the creator's link.
    for (let n = 0; n < 20; n++) {
      await request.post(`${API_URL}/referrals/${me.referral_code}/visit`, { data: { visitor_id: `visitor-${n}-${Date.now()}` } });
    }
    await page.reload();

    const pager = activity.getByRole("navigation", { name: "Activity pages" });
    await expect(activity.getByText("Someone opened your link")).toHaveCount(8); // a page, not everything
    await expect(pager.getByText("1–8 of 20")).toBeVisible();
    await expect(pager.getByText("Page 1 of 3")).toBeVisible();
    await expect(pager.getByRole("button", { name: "Previous" })).toBeDisabled();

    await pager.getByRole("button", { name: "Next" }).click();
    await expect(pager.getByText("9–16 of 20")).toBeVisible();
    await pager.getByRole("button", { name: "Next" }).click();
    await expect(pager.getByText("17–20 of 20")).toBeVisible();
    await expect(activity.getByText("Someone opened your link")).toHaveCount(4); // the last, shorter page
    await expect(pager.getByRole("button", { name: "Next" })).toBeDisabled();
    await pager.getByRole("button", { name: "Previous" }).click();
    await expect(pager.getByText("9–16 of 20")).toBeVisible();
    if (SHOT) await page.screenshot({ path: `${SHOT}/activity-paged.png`, fullPage: true });
  });

  test("the overall link is shown in full, with a copy button", async ({ page, request }) => {
    const me = await approvedCreator(page, request);
    const card = page.locator("section").filter({ hasText: "Your overall link" });
    const link = card.getByLabel("Your overall referral link");
    await expect(link).toHaveText(new RegExp(`/creator/${me.referral_code}$`));
    // Not clipped: its text is wholly on screen.
    const box = (await link.boundingBox())!;
    const parent = (await card.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(parent.x + parent.width + 1);
    await expect(card.getByRole("button", { name: "Copy link" })).toBeVisible();
  });

  test("the profile: a dropdown in the header, photos and the name on their page, then sign out", async ({ page, request }) => {
    await approvedCreator(page, request);

    // No loose Sign out button in the header: it's in the account menu with Profile.
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
    await expect(page.getByText("Make your page yours")).toBeVisible();
    await page.getByRole("button", { name: "Account menu" }).click();
    const menu = page.getByRole("menu", { name: "Account" });
    await expect(menu.getByRole("menuitem", { name: "Profile" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    await page.getByRole("button", { name: "Account menu" }).click();
    await menu.getByRole("menuitem", { name: "Profile" }).click();
    await expect(page).toHaveURL(`${CREATOR_URL}/profile`);
    await expect(page.getByRole("heading", { level: 1, name: "Your profile" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your page", exact: true })).toBeVisible();
    await expect(page.getByText(/Your page shows once you have a published trip/)).toBeVisible();
    const avatarFile = path.resolve(__dirname, "fixtures/avatar.png");
    const coverFile = path.resolve(__dirname, "fixtures/cover.png");

    // A picture that's too small is refused with its size, before anything is uploaded.
    await page.getByLabel("Upload a cover photo").setInputFiles(path.resolve(__dirname, "fixtures/cover-small.png"));
    await expect(page.getByTestId("photo-problem")).toContainText("800×300px");
    await expect(page.getByTestId("photo-problem")).toContainText("1200×400px");
    await expect(page.getByAltText("Your cover photo")).toHaveCount(0);

    await page.getByLabel("Upload a profile photo").setInputFiles(avatarFile);
    const avatar = page.getByAltText("Your profile photo");
    await expect(avatar).toBeVisible();
    await expect.poll(() => avatar.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    // …and the photo is the picture in the header's avatar too.
    await expect(page.getByRole("button", { name: "Account menu" }).locator("img")).toBeVisible();

    await page.getByLabel("Upload a cover photo").setInputFiles(coverFile);
    await expect(page.getByAltText("Your cover photo")).toBeVisible();
    await expect(page.getByTestId("photo-problem")).toHaveCount(0); // the earlier message is gone
    await expect(page.getByRole("button", { name: "Change cover photo" })).toBeVisible();
    if (SHOT) await page.screenshot({ path: `${SHOT}/profile-page.png`, fullPage: true });

    // The photos are kept: a reload still shows them.
    await page.reload();
    await expect(page.getByAltText("Your profile photo")).toBeVisible();
    await expect(page.getByAltText("Your cover photo")).toBeVisible();

    // The name on their page.
    const name = page.getByLabel("Name on your page");
    await expect(name).toHaveValue("Meera Kamat");
    await expect(page.getByRole("button", { name: "Save name" })).toBeDisabled();
    await name.fill("M");
    await expect(page.getByRole("button", { name: "Save name" })).toBeDisabled(); // too short
    await name.fill("  Meera   K ");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByRole("button", { name: "Account menu" })).toContainText("Meera K");
    await page.goto(`${CREATOR_URL}/`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Meera K");
    // With both photos on, the nudge is gone.
    await expect(page.getByText("Make your page yours")).toHaveCount(0);

    // Instagram and YouTube: a bare @handle is kept as a full link, and can be changed or removed.
    await page.goto(`${CREATOR_URL}/profile`);
    const instagram = page.getByLabel("Instagram");
    const youtube = page.getByLabel("YouTube");
    await expect(page.getByRole("button", { name: "Save channels" })).toBeDisabled();
    await instagram.fill("@Meera.Kamat");
    await youtube.fill("@meerakamat");
    await page.getByRole("button", { name: "Save channels" }).click();
    await expect(instagram).toHaveValue("https://www.instagram.com/meera.kamat/");
    await expect(youtube).toHaveValue("https://www.youtube.com/@meerakamat");
    await page.reload();
    await expect(instagram).toHaveValue("https://www.instagram.com/meera.kamat/");
    await youtube.fill("");
    await page.getByRole("button", { name: "Save channels" }).click();
    await expect(page.getByRole("button", { name: "Save channels" })).toBeDisabled();
    await page.reload();
    await expect(youtube).toHaveValue("");
    await instagram.fill("https://example.com/nope");
    await page.getByRole("button", { name: "Save channels" }).click();
    await expect(page.getByText("Instagram handle")).toBeVisible();

    // Photos can be taken off again.
    await page.goto(`${CREATOR_URL}/profile`);
    await page.getByRole("button", { name: "Remove cover photo" }).click();
    await expect(page.getByAltText("Your cover photo")).toHaveCount(0);
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByAltText("Your profile photo")).toHaveCount(0);

    // Signing out is in the menu.
    await page.getByRole("button", { name: "Account menu" }).click();
    await menu.getByRole("menuitem", { name: "Sign out" }).click();
    // Signed out, the creator programme is on the traveller website.
    await expect(page).toHaveURL(`${WEBSITE}/creators`);
  });

  test("a creator who isn't approved yet sees why they can't make links", async ({ page }) => {
    const email = `e2e-pendinglinks-${Date.now()}@creators.example.com`;
    await page.goto(`${CREATOR_URL}/login`);
    await expect(page).toHaveURL(new RegExp(`^${SSO_URL}/sso/login`));
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByLabel("Sign-in code").fill(DEV_CODE);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${CREATOR_URL}/`);

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
