import { expect, test } from "@playwright/test";
import { DEV_CODE, SSO_URL } from "./fixtures";

/**
 * The website's /api/wt gateway is the only way a browser reaches the backend. It must forward
 * exactly the traveler routes and nothing else — whatever the method, path tricks or IDs.
 */
const UUID = "00000000-0000-4000-8000-000000000000";

test.describe("Gateway allowlist", () => {
  test("public explore routes pass through for anyone", async ({ request }) => {
    expect((await request.get("/api/wt/explore/destinations")).status()).toBe(200);
    expect((await request.get("/api/wt/explore/tags")).status()).toBe(200);
    expect((await request.get(`/api/wt/explore/places/${UUID}`)).status()).toBe(404); // backend: no such place
  });

  test("signed-in traveler routes are forwarded and need a session", async ({ request }) => {
    for (const [method, path] of [
      ["GET", "/api/wt/auth/me"], ["GET", "/api/wt/profiles/me"], ["GET", "/api/wt/profiles/me/saved"],
      ["GET", `/api/wt/recommendations?city_id=${UUID}`], ["GET", "/api/wt/chat/sessions"],
      ["GET", "/api/wt/search/semantic?q=tea"],
    ] as const) {
      const res = await request.fetch(path, { method });
      expect(res.status(), `${method} ${path}`).toBe(401); // reached the backend, which wants auth
    }
  });

  test("staff and unknown routes never leave the website", async ({ request }) => {
    const blocked: [string, string][] = [
      ["GET", "/api/wt/admin/users"],
      ["GET", "/api/wt/admin/locations"],
      ["GET", "/api/wt/admin/stats"],
      ["POST", "/api/wt/admin/tags"],
      ["GET", `/api/wt/admin/travelers/${UUID}`],
      ["GET", "/api/wt/admin/audit-log"],
      ["POST", "/api/wt/admin/locations/reindex"],
      ["GET", "/api/wt/health"],
      ["GET", "/api/wt/docs"],
      ["GET", "/api/wt/openapi.json"],
      ["POST", "/api/wt/auth/login"], // staff sign in on the dashboard, never through the website
      ["POST", "/api/wt/auth/register"],
      ["POST", "/api/wt/auth/otp/verify"], // codes are checked on the SSO app, which sets the cookies
      // right route, wrong method
      ["DELETE", "/api/wt/profiles/me"],
      ["POST", "/api/wt/explore/destinations"],
      ["DELETE", "/api/wt/profiles/me/saved"],
      // malformed IDs and path tricks
      ["GET", "/api/wt/chat/sessions/not-a-uuid"],
      ["GET", "/api/wt/explore/places/1%20OR%201=1"],
      ["GET", "/api/wt/profiles/me/../../admin/users"],
      ["GET", "/api/wt/explore/..%2Fadmin%2Fusers"],
      ["GET", "/api/wt/explore/destinations/x/../../../admin/users"],
    ];
    for (const [method, path] of blocked) {
      const res = await request.fetch(path, { method });
      expect([404, 405], `${method} ${path} → ${res.status()}`).toContain(res.status());
      const body = await res.text();
      expect(body, `${method} ${path} must not reach the backend`).not.toContain("Not authenticated");
      expect(body).not.toContain("Insufficient permissions");
    }
  });

  test("sign-in sets httpOnly cookies and never returns tokens to the browser", async ({ request }) => {
    const email = `e2e-gw-${Date.now()}@example.com`;
    // Codes are checked on the SSO app, which mints the shared session cookies.
    const sent = await request.post(`${SSO_URL}/api/sso/code/request`, { data: { email } });
    expect(sent.status()).toBe(202);
    const res = await request.post(`${SSO_URL}/api/sso/code/verify`, { data: { email, code: DEV_CODE } });
    expect(res.status()).toBe(200);
    expect(Object.keys(await res.json()).sort()).toEqual(["ok", "redirect"]); // no tokens in the body
    const cookies = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);
    // The shared SSO session names, so this session works on every wishtrip app.
    expect(cookies.some((c) => c.startsWith("wt_session=") && /HttpOnly/i.test(c))).toBe(true);
    expect(cookies.some((c) => c.startsWith("wt_refresh=") && /HttpOnly/i.test(c))).toBe(true);
    // The session works through the gateway.
    expect((await request.get("/api/wt/auth/me")).status()).toBe(200);
  });
});
