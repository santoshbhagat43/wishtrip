import { expect, test } from "../fixtures/test";
import { ADMIN, API_URL } from "../utils/env";

const DEV_CODE = process.env.CREATOR_DEV_OTP ?? "1234";

test.describe("Creator onboarding", () => {
  test("staff approve, remind, check the bank details and activate: each step is a button", async ({ page, request, apiLog: _ }) => {
    const stamp = Date.now().toString(36);
    const staff = {
      Authorization: `Bearer ${(await (await request.post(`${API_URL}/auth/login`, { data: ADMIN })).json()).access_token}`,
    };
    const email = `e2e-onb-${stamp}@creators.example.com`;
    await request.post(`${API_URL}/auth/creator/request-otp`, { data: { email } });
    const token = (await (await request.post(`${API_URL}/auth/creator/verify`, { data: { email, code: DEV_CODE } })).json()).access_token;
    const creatorAuth = { Authorization: `Bearer ${token}` };
    const me = await (await request.get(`${API_URL}/creators/me`, { headers: creatorAuth })).json();

    await page.goto(`/creators/${me.id}`);
    const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Onboarding", exact: true }) });
    await expect(card.getByText("✓ Applied")).toBeVisible();
    await expect(card.getByRole("button", { name: "Reject and send the update email" })).toBeVisible();

    // Approve: the welcome email goes out; now it waits for bank details.
    await card.getByRole("button", { name: "Approve and send the welcome email" }).click();
    await expect(card.getByText("✓ Approved")).toBeVisible();
    await expect(card.getByText("No reminder sent yet.")).toBeVisible();

    // The reminder.
    await card.getByRole("button", { name: "Send bank details reminder" }).click();
    await expect(card.getByText(/^Last reminded /)).toBeVisible();

    // The creator sends their details; staff see them masked, then in full on request.
    const sent = await request.put(`${API_URL}/creators/me/bank-details`, {
      headers: creatorAuth,
      data: { holder: "Asha Rao", bank_name: "HDFC Bank", ifsc: "HDFC0001234", account_number: "50100123456789", upi: "" },
    });
    expect(sent.ok()).toBe(true);
    await page.reload();
    await expect(card.getByText("•••• •••• 6789")).toBeVisible();
    await expect(card.getByText("50100123456789")).toHaveCount(0);
    await card.getByRole("button", { name: "Show full number" }).click();
    await expect(card.getByText("50100123456789")).toBeVisible();

    // Confirm: the account is active.
    await card.getByRole("button", { name: "Confirm bank details and activate the account" }).click();
    await expect(card.getByText(/Bank details confirmed on .* The account is active\./)).toBeVisible();
    await expect(card.getByText("✓ Account active")).toBeVisible();
  });

  test("an application can be rejected with an email", async ({ page, request, apiLog: _ }) => {
    const email = `e2e-rej-${Date.now().toString(36)}@creators.example.com`;
    await request.post(`${API_URL}/auth/creator/request-otp`, { data: { email } });
    const token = (await (await request.post(`${API_URL}/auth/creator/verify`, { data: { email, code: DEV_CODE } })).json()).access_token;
    const me = await (await request.get(`${API_URL}/creators/me`, { headers: { Authorization: `Bearer ${token}` } })).json();

    await page.goto(`/creators/${me.id}`);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Reject and send the update email" }).click();
    await expect(page.getByText(/^Rejected on /)).toBeVisible();
    await expect(page.getByText("Rejected", { exact: true }).first()).toBeVisible();
  });
});
