import { ADMIN } from "../utils/env";
import { expect, test } from "./client";

const DEV_CODE = process.env.CREATOR_DEV_OTP ?? "1234";

test.describe("System & auth API", () => {
  test("GET /health reports database, AI and embedder status", async ({ anon }) => {
    const { body } = await anon.get("/health");
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("ai_enabled");
    expect(body).toHaveProperty("embedder");
  });

  test("POST /auth/login → tokens; GET /auth/me → profile", async ({ request, anon }) => {
    const { body: tokens } = await anon.post("/auth/login", { data: ADMIN, status: 200 });
    expect(tokens.token_type).toBe("bearer");
    const res = await request.get("/auth/me", { headers: { authorization: `Bearer ${tokens.access_token}` } });
    expect((await res.json()).role).toBe("admin");
  });

  test("POST /auth/login rejects a wrong password with 401", async ({ anon }) => {
    await anon.post("/auth/login", { data: { email: ADMIN.email, password: "wrong-password" }, status: 401 });
  });

  test("a traveller signs in with a code (no password); POST /auth/refresh rotates tokens", async ({ anon }) => {
    const email = `e2e-code-${Date.now()}@example.com`;
    await anon.post("/auth/otp/request", { data: { email }, status: 202 });
    await anon.post("/auth/otp/verify", { data: { email, code: "000000" }, status: 400 }); // wrong code
    const { body } = await anon.post("/auth/otp/verify", { data: { email, code: DEV_CODE }, status: 200 });
    const { body: refreshed } = await anon.post("/auth/refresh", { data: { refresh_token: body.refresh_token }, status: 200 });
    expect(refreshed.access_token).toBeTruthy();
    // An access token is not accepted as a refresh token.
    await anon.post("/auth/refresh", { data: { refresh_token: body.access_token }, status: 401 });
  });

  test("there is no password sign-up, and a team account can't sign in with a code", async ({ anon, admin }) => {
    const email = `e2e-register-${Date.now()}@example.com`;
    await anon.post("/auth/register", { data: { email, password: "e2e-password-123" }, status: 404 });
    const staff = `e2e-staff-code-${Date.now()}@example.com`;
    await admin.post("/admin/users", { data: { email: staff, password: "e2e-password-123", full_name: "E2E Staff", role: "editor" }, status: 201 });
    await anon.post("/auth/otp/request", { data: { email: staff }, status: 202 });
    await anon.post("/auth/otp/verify", { data: { email: staff, code: DEV_CODE }, status: 403 });
  });

  test("role enforcement: anonymous 401, traveler 403 on staff routes", async ({ anon, traveler }) => {
    await anon.get("/admin/locations", { status: 401 });
    await traveler.get("/admin/locations", { status: 403 });
    await traveler.get("/admin/users", { status: 403 });
    await traveler.get("/auth/me");
  });
});
