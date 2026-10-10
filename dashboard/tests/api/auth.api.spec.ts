import { ADMIN } from "../utils/env";
import { expect, test } from "./client";

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

  test("POST /auth/register creates a traveler; POST /auth/refresh rotates tokens", async ({ anon }) => {
    const email = `e2e-register-${Date.now()}@example.com`;
    const { body } = await anon.post("/auth/register", { data: { email, password: "e2e-password-123" }, status: 201 });
    const { body: refreshed } = await anon.post("/auth/refresh", { data: { refresh_token: body.refresh_token }, status: 200 });
    expect(refreshed.access_token).toBeTruthy();
    // An access token is not accepted as a refresh token.
    await anon.post("/auth/refresh", { data: { refresh_token: body.access_token }, status: 401 });
    await anon.post("/auth/register", { data: { email, password: "e2e-password-123" }, status: 409 });
  });

  test("role enforcement: anonymous 401, traveler 403 on staff routes", async ({ anon, traveler }) => {
    await anon.get("/admin/locations", { status: 401 });
    await traveler.get("/admin/locations", { status: 403 });
    await traveler.get("/admin/users", { status: 403 });
    await traveler.get("/auth/me");
  });
});
