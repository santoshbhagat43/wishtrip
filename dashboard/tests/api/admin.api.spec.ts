import { expect, test } from "./client";

test.describe("Users & audit API (admin only)", () => {
  test("GET/POST/PATCH /admin/users manages staff accounts", async ({ admin, anon }) => {
    const email = `e2e-staff-${Date.now()}@example.com`;
    const { body: user } = await admin.post("/admin/users", {
      data: { email, password: "e2e-password-123", full_name: "E2E Staff", role: "editor" },
      status: 201,
    });
    const { body: list } = await admin.get("/admin/users", { params: { role: "editor", page_size: 100 } });
    expect(list.items.some((u: any) => u.id === user.id)).toBe(true);

    await anon.post("/auth/login", { data: { email, password: "e2e-password-123" }, status: 200 });
    const { body: disabled } = await admin.patch(`/admin/users/${user.id}`, { data: { is_active: false } });
    expect(disabled.is_active).toBe(false);
    await anon.post("/auth/login", { data: { email, password: "e2e-password-123" }, status: 401 });
  });

  test("GET /admin/audit-log pages through changes", async ({ admin }) => {
    const { body } = await admin.get("/admin/audit-log", { params: { page_size: 5 } });
    expect(body.items.length).toBeLessThanOrEqual(5);
    expect(body).toHaveProperty("total");
  });
});
