/**
 * The public Creator trips page (/creators/trips) and a creator's own page (/creator/<handle>),
 * with the spotlight staff choose in the dashboard. Real data only: an approved creator with a
 * published trip. Runs against the real stack; the creator is set up through the API.
 */
import { publishedCreator } from "./creator-helpers";
import { API_URL, CREATOR_URL, expect, test } from "./fixtures";

const DEV_CODE = process.env.CREATOR_DEV_OTP ?? "1234";
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "", password: process.env.ADMIN_PASSWORD ?? "" };

test.describe("Creator trips and creator pages", () => {
  test("the Creator trips page shows the spotlight and every creator, each with their own page", async ({ page, request }) => {
    const c = await publishedCreator(request);
    const set = await request.put(`${API_URL}/spotlight/trips/${c.tripId}`, { headers: c.staff, data: { on: true } });
    expect(set.status()).toBe(200);

    await page.goto("/creators/trips");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Trips made by travel creators");
    // The header's Creator trips link goes here.
    await expect(page.getByRole("link", { name: "Creator trips" }).first()).toHaveAttribute("href", "/creators/trips");

    // Only real numbers: no follower or booking counts.
    await expect(page.getByText(/followers|travellers booked|EXAMPLE DATA/i)).toHaveCount(0);
    // And no static marketing blocks: everything on the page comes from real creators and trips.
    await expect(page.getByText(/HOW CREATOR TRIPS WORK/i)).toHaveCount(0);

    const spotlight = page.getByRole("region", { name: /CREATOR IN THE SPOTLIGHT/i });
    await expect(spotlight.getByRole("heading", { name: "Ananya Pages" })).toBeVisible();
    await expect(spotlight.getByText(`@${c.handle}`)).toBeVisible();
    await expect(spotlight.getByText("Slow North Goa").first()).toBeVisible();

    const all = page.getByRole("region", { name: "More creators who travel like you" });
    await expect(all.getByRole("link", { name: new RegExp(`@${c.handle.replace(".", "\\.")}`) })).toBeVisible();

    await spotlight.getByRole("link", { name: /See Ananya.s page/ }).click();
    await expect(page).toHaveURL(new RegExp(`/creator/${c.handle.replace(".", "\\.")}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Ananya Pages" })).toBeVisible();
    await expect(page.getByText("✓ wishtrip creator")).toBeVisible();
    await expect(page.getByRole("heading", { name: "The trips they actually took" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Make it mine" })).toHaveAttribute("href", /^\/arya\?prompt=/);
    await expect(page.getByText(/6 stops/).first()).toBeVisible();

    await page.getByRole("link", { name: "See day by day" }).click();
    await expect(page).toHaveURL(/\/t\/[a-z0-9-]+$/);

    // Staff take it away: the page falls back to the creator with the most trips (so the section
    // is never missing), and this creator stays in the list.
    await request.put(`${API_URL}/spotlight/trips/${c.tripId}`, { headers: c.staff, data: { on: false } });
    expect((await (await request.get(`${API_URL}/explore/creators`)).json()).spotlight_chosen).toBe(false);
    await page.goto("/creators/trips");
    await expect(page.getByText("CREATOR IN THE SPOTLIGHT")).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(`@${c.handle.replace(".", "\\.")}`) })).toBeVisible();
  });

  test("/creator/<handle> is public; an unknown handle is a 404; a UUID still belongs to the portal", async ({ request, baseURL }) => {
    const c = await publishedCreator(request);
    const profile = await request.get(`${baseURL}/creator/${c.handle}`);
    expect(profile.status()).toBe(200);
    expect(await profile.text()).toContain("The trips they actually took");

    expect((await request.get(`${baseURL}/creator/nobody-has-this-handle`)).status()).toBe(404);

    const portal = await request.get(`${baseURL}/creator/${c.tripId}`, { maxRedirects: 0 });
    expect(portal.status()).toBe(307);
    expect(portal.headers()["location"]).toBe(`${CREATOR_URL}/${c.tripId}`);
  });

  test("the creator site has clean addresses: no /creator in them, and the old ones redirect", async ({ request }) => {
    const id = "7f55db57-2a9d-4c45-9ad0-b2bcbf8c0a87";
    const go = (p: string) => request.get(`${CREATOR_URL}${p}`, { maxRedirects: 0 });
    // The old dashboard address, signed out, goes straight to sign-in and comes back to "/".
    const legacy = await go("/creator");
    expect(legacy.status()).toBe(307);
    expect(new URL(legacy.headers()["location"]).searchParams.get("redirect")).toBe(`${CREATOR_URL}/`);
    for (const [old, clean] of [
      [`/creator/${id}`, `/${id}`],
      [`/creator/trips/${id}`, `/trips/${id}`],
    ]) {
      const r = await go(old);
      expect([307, 308], old).toContain(r.status());
      expect(new URL(r.headers()["location"], CREATOR_URL).pathname).toBe(clean);
    }
    // A visitor who isn't signed in is sent to sign in, and brought back to the clean address.
    for (const clean of [`/${id}`, `/trips/${id}`]) {
      const r = await go(clean);
      expect(r.status()).toBe(307);
      const back = new URL(r.headers()["location"]).searchParams.get("redirect");
      expect(back).toBe(`${CREATOR_URL}${clean}`);
    }
    expect((await go("/")).headers()["location"]).toContain("/creators");
  });

  test("a creator staff haven't given a handle yet is still shown, at their referral code", async ({ page, request }) => {
    const c = await publishedCreator(request, { withHandle: false });
    await page.goto("/creators/trips");
    const all = page.getByRole("region", { name: "More creators who travel like you" });
    const tile = all.getByRole("link", { name: new RegExp(c.name) });
    await expect(tile).toBeVisible();
    // No "@handle" to show, so the name is what's shown.
    await expect(tile).not.toContainText("@");
    await tile.click();
    await expect(page).toHaveURL(new RegExp(`/creator/${c.slug}$`));
    await expect(page.getByRole("heading", { level: 1, name: c.name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The trips they actually took" })).toBeVisible();
    // Staff can feature their trip: the dashboard has no handle to show for them.
    const set = await request.put(`${API_URL}/spotlight/trips/${c.tripId}`, { headers: c.staff, data: { on: true } });
    expect(set.status()).toBe(200);
    await page.goto("/creators/trips");
    await expect(page.getByRole("region", { name: /CREATOR IN THE SPOTLIGHT/i }).getByRole("heading", { name: c.name })).toBeVisible();
    await request.put(`${API_URL}/spotlight/trips/${c.tripId}`, { headers: c.staff, data: { on: false } });
  });

  test("a creator with no published trip is not shown", async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const email = `e2e-nopub-${stamp}@creators.example.com`;
    await request.post(`${API_URL}/auth/creator/request-otp`, { data: { email } });
    const verified = await request.post(`${API_URL}/auth/creator/verify`, { data: { email, code: DEV_CODE } });
    const me = await (await request.get(`${API_URL}/creators/me`, { headers: { Authorization: `Bearer ${(await verified.json()).access_token}` } })).json();
    const login = await request.post(`${API_URL}/auth/login`, { data: ADMIN });
    await request.patch(`${API_URL}/creators/${me.id}`, {
      headers: { Authorization: `Bearer ${(await login.json()).access_token}` },
      data: { status: "active", handle: `quiet.${stamp}`, display_name: "Quiet Creator" },
    });
    await page.goto("/creators/trips");
    await expect(page.getByText("Quiet Creator")).toHaveCount(0);
    expect((await request.get(`${page.url().split("/creators")[0]}/creator/quiet.${stamp}`)).status()).toBe(404);
  });
});
