import { expect, test } from "../fixtures/test";
import { ADMIN, API_URL } from "../utils/env";

const DEV_CODE = process.env.CREATOR_DEV_OTP ?? "1234";

test.describe("Creators list", () => {
  test("staff search the creators and page through them", async ({ page, request, apiLog: _ }) => {
    test.setTimeout(120_000);
    const stamp = Date.now().toString(36);
    const staff = {
      Authorization: `Bearer ${(await (await request.post(`${API_URL}/auth/login`, { data: ADMIN })).json()).access_token}`,
    };
    // 22 creators who share a stamp: one more than a page. Two of them get a handle and a name.
    const emails: string[] = [];
    for (let n = 0; n < 22; n++) {
      const email = `e2e-list-${String(n).padStart(2, "0")}-${stamp}@creators.example.com`;
      emails.push(email);
      await request.post(`${API_URL}/auth/creator/request-otp`, { data: { email } });
      await request.post(`${API_URL}/auth/creator/verify`, { data: { email, code: DEV_CODE } });
    }
    const named = await (await request.get(`${API_URL}/creators`, { headers: staff, params: { q: `list-07-${stamp}` } })).json();
    await request.patch(`${API_URL}/creators/${named.items[0].id}`, {
      headers: staff,
      data: { handle: `searchme.${stamp}`, display_name: `Findable ${stamp}` },
    });

    await page.goto("/creators");
    const rows = page.locator("tbody tr");
    const search = page.getByRole("searchbox", { name: "Search creators" });

    // Search by a word they share: a whole page, and the next page with the rest.
    await search.fill(stamp);
    await expect(page.getByText("1–20 of 22")).toBeVisible();
    await expect(rows).toHaveCount(20);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("21–22 of 22")).toBeVisible();
    await expect(rows).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByText("1–20 of 22")).toBeVisible();

    // A new search starts again from the first page.
    await page.getByRole("button", { name: "Next" }).click();
    await search.fill(`searchme.${stamp}`);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`@searchme.${stamp}`);
    await expect(rows.first()).toContainText(`Findable ${stamp}`);
    await expect(page.getByText("1–1 of 1")).toBeVisible();

    // By name, by part of an email, with and without the @.
    await search.fill(`findable ${stamp}`);
    await expect(rows).toHaveCount(1);
    await search.fill(`@SEARCHME`);
    await expect(rows.first()).toContainText(`@searchme.${stamp}`);
    await search.fill(emails[3].split("@")[0]);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(emails[3]);

    // Nothing found says so; clearing the search brings everyone back.
    await search.fill(`nobody-has-this-${stamp}`);
    await expect(page.getByText(/No creators match/)).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(search).toHaveValue("");
    await expect(rows.first()).toBeVisible();
    await expect(page.getByText(/^1–20 of \d+$/)).toBeVisible();

    // Search and the status filter work together: these 22 are all still pending.
    await search.fill(stamp);
    await page.getByRole("button", { name: /^Pending/ }).click();
    await expect(page.getByText("1–20 of 22")).toBeVisible();
    await page.getByRole("button", { name: "Affiliates" }).click();
    await expect(page.getByText(/No creators match/)).toBeVisible();
  });
});
