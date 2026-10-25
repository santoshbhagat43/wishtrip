/** Set-up shared by the specs that need a real, published creator trip. */
import { execSync } from "node:child_process";
import path from "node:path";

import { expect, type APIRequestContext } from "@playwright/test";

import { API_URL } from "./fixtures";

const DEV_CODE = process.env.CREATOR_DEV_OTP ?? "1234";
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "", password: process.env.ADMIN_PASSWORD ?? "" };

function seedReel(shortcode: string) {
  execSync(`docker compose exec -T backend python -m app.scripts.dev_reel ${shortcode}`, {
    cwd: path.resolve(__dirname, "../.."),
    stdio: "ignore",
  });
}

/** An approved creator and one published trip, made through the API. Staff give them a handle
 *  unless `withHandle` is false: then their page is at their referral code. */
export async function publishedCreator(request: APIRequestContext, { withHandle = true } = {}) {
  const stamp = Date.now().toString(36);
  const email = `e2e-pages-${stamp}@creators.example.com`;
  await request.post(`${API_URL}/auth/creator/request-otp`, { data: { email } });
  const verified = await request.post(`${API_URL}/auth/creator/verify`, { data: { email, code: DEV_CODE } });
  const creatorAuth = { Authorization: `Bearer ${(await verified.json()).access_token}` };
  const login = await request.post(`${API_URL}/auth/login`, { data: ADMIN });
  const staff = { Authorization: `Bearer ${(await login.json()).access_token}` };

  const me = await (await request.get(`${API_URL}/creators/me`, { headers: creatorAuth })).json();
  const handle = `pages.${stamp}`;
  await request.patch(`${API_URL}/creators/${me.id}`, {
    headers: staff,
    data: { status: "active", ...(withHandle ? { handle } : {}), display_name: withHandle ? "Ananya Pages" : `Nohandle ${stamp}` },
  });

  const shortcode = `Cpg${stamp}`;
  seedReel(shortcode);
  const started = await request.post(`${API_URL}/creator/trips/import`, {
    headers: creatorAuth,
    data: { url: `https://www.instagram.com/reel/${shortcode}/` },
  });
  expect(started.status()).toBe(201);
  await expect
    .poll(async () => (await (await request.get(`${API_URL}/creator/trips`, { headers: creatorAuth })).json()).length, {
      timeout: 60_000,
    })
    .toBe(1);
  const [trip] = await (await request.get(`${API_URL}/creator/trips`, { headers: creatorAuth })).json();
  await request.patch(`${API_URL}/creator/trips/${trip.id}`, {
    headers: creatorAuth,
    data: { title: "Slow North Goa", publish: true },
  });
  return {
    id: me.id as string,
    handle,
    slug: withHandle ? handle : (me.referral_code as string),
    name: withHandle ? "Ananya Pages" : `Nohandle ${stamp}`,
    staff,
    tripId: trip.id as string,
  };
}

