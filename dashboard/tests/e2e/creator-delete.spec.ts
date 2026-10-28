import { expect, test } from "../fixtures/test";
import { ADMIN, API_URL } from "../utils/env";

test.describe("Delete a creator", () => {
  test("an applicant is a registered creator at once, and an admin can delete them to test again", async ({ page, request, apiLog: _ }) => {
    const email = `e2e-del-${Date.now().toString(36)}@creators.example.com`;
    const apply = () => request.post(`${API_URL}/creators/apply`, { data: { email, name: "Del Test", handle: "" , youtube: "https://www.youtube.com/@deltest" } });
    expect((await apply()).status()).toBe(202);

    const staff = {
      Authorization: `Bearer ${(await (await request.post(`${API_URL}/auth/login`, { data: ADMIN })).json()).access_token}`,
    };
    const listed = await (await request.get(`${API_URL}/creators?q=${encodeURIComponent(email)}`, { headers: staff })).json();
    const id = listed.items[0].id as string;

    await page.goto(`/creators/${id}`);
    const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Delete this creator" }) });
    await card.getByRole("button", { name: "Delete creator" }).click();
    await expect(card.getByText(/for good\?/)).toBeVisible();
    await card.getByRole("button", { name: "Keep" }).click();
    await expect(card.getByRole("button", { name: "Delete creator" })).toBeVisible();

    await card.getByRole("button", { name: "Delete creator" }).click();
    await card.getByRole("button", { name: "Yes, delete" }).click();
    await expect(page).toHaveURL(/\/creators$/);
    expect((await request.get(`${API_URL}/creators/${id}`, { headers: staff })).status()).toBe(404);

    // The same email starts from scratch.
    expect((await apply()).status()).toBe(202);
  });
});
