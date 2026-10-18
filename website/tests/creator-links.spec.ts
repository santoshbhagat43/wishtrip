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
  test("a creator makes a link, uses it, then adds the reel — and sees that link's numbers", async ({
    page,
    request,
    browser,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await approvedCreator(page, request);

    // The section explains the three steps, and starts empty.
    const section = page.locator("section").filter({ hasText: "Your reel links" });
    await expect(section.getByText("Create a link")).toBeVisible();
    await expect(section.getByText("Use it in your reel")).toBeVisible();
    await expect(section.getByText("Add the reel's URL")).toBeVisible();
    await expect(section.getByText("No reel links yet")).toBeVisible();

    // 1. Create a referral link, pointed at a destination.
    await section.getByRole("button", { name: "Create referral link" }).click();
    await section.getByLabel("What’s the reel about?").fill("Goa beach weekend");
    await section.getByLabel("Where should travellers land?").selectOption({ label: "Goa" });
    await section.getByRole("button", { name: "Create link" }).click();

    // It's waiting for a reel, with a short link shown in full.
    await expect(section.getByText("Waiting for your reel")).toBeVisible();
    const short = section.locator("code").first();
    const shortText = (await short.textContent())!.trim();
    expect(shortText).toMatch(/\/r\/goa-[a-z0-9]{4}$/);
    await expect(section.getByText("Opens Goa")).toBeVisible();
    await expect(section.getByText("Posted it? Add the reel")).toBeVisible();
    if (SHOT) await page.screenshot({ path: `${SHOT}/links-waiting.png`, fullPage: true });

    // 2. A traveller opens the link from the reel (on the traveller site, as a stranger).
    const code = shortText.split("/r/")[1];
    const visitor = await browser.newContext();
    const visit = await visitor.request.get(`${process.env.WEBSITE_URL ?? "http://app.lvh.me:3002"}/r/${code}`, {
      maxRedirects: 0,
    });
    expect(visit.status()).toBe(307);
    expect(visit.headers()["location"]).toMatch(/^\/explore\/[0-9a-f-]{36}$/); // the Goa page
    const cookies = visit.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);
    expect(cookies.some((c) => c.startsWith("wishtrip_link=" + code))).toBe(true);
    await visitor.close();

    // 3. The reel is posted: add its Instagram URL.
    await page.reload();
    // The links list (the three steps above it are an <ol>).
    const row = section.locator("ul > li").first();
    await expect(row.getByText("Visits").locator("xpath=..").getByText("1", { exact: true })).toBeVisible();
    await row.getByLabel("Posted it? Add the reel").fill("not an instagram link");
    await row.getByRole("button", { name: "Add reel" }).click();
    await expect(row.getByText(/Paste the link to your Instagram reel/)).toBeVisible();

    await row.getByLabel("Posted it? Add the reel").fill("https://www.instagram.com/reel/Ce2eLinkAb1/?igsh=xyz");
    await row.getByRole("button", { name: "Add reel" }).click();
    await expect(row.getByText("Live", { exact: true })).toBeVisible();
    await expect(row.getByRole("link", { name: "View the reel" })).toHaveAttribute(
      "href",
      "https://www.instagram.com/reel/Ce2eLinkAb1/",
    );
    await expect(row.getByText("Waiting for your reel")).toHaveCount(0);
    if (SHOT) await page.screenshot({ path: `${SHOT}/links-live.png`, fullPage: true });

    // It can be changed or removed again.
    await row.getByRole("button", { name: "Change or remove the reel" }).click();
    await row.getByLabel("Instagram reel URL").fill("");
    await row.getByRole("button", { name: "Remove reel" }).click();
    await expect(row.getByText("Waiting for your reel")).toBeVisible();

    expect(pageErrors).toEqual([]);
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

    const section = page.locator("section").filter({ hasText: "Your reel links" });
    await expect(section.getByText("unlock as soon as the WishTrip team approves")).toBeVisible();
    await expect(section.getByRole("button", { name: "Create referral link" })).toHaveCount(0);
  });

  test("an unknown reel link just opens the home page", async ({ request }) => {
    const res = await request.get(`/r/nope-0000`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toBe("/");
  });
});
