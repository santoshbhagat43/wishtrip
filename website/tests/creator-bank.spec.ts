/** A creator's bank details (creator.<domain>/profile#bank-details): sent once approved, shown back
 *  masked, and confirmed by staff, which makes the account active. */
import { API_URL, CREATOR_URL, DEV_CODE, expect, test } from "./fixtures";

const ADMIN = { email: process.env.ADMIN_EMAIL ?? "", password: process.env.ADMIN_PASSWORD ?? "" };

test("a creator sends bank details after approval, sees them masked, and staff confirm them", async ({ page, request }) => {
  const email = `e2e-bank-${Date.now()}@creators.example.com`;
  await page.goto(`${CREATOR_URL}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Sign-in code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${CREATOR_URL}/`);

  // Not approved yet: the card waits.
  await page.goto(`${CREATOR_URL}/profile`);
  await expect(page.getByText("You can add them as soon as your application is approved.")).toBeVisible();

  const login = await request.post(`${API_URL}/auth/login`, { data: ADMIN });
  const staff = { Authorization: `Bearer ${(await login.json()).access_token}` };
  const found = (await (await request.get(`${API_URL}/creators`, { headers: staff, params: { q: email } })).json()) as {
    items: { id: string; email: string }[];
  };
  const id = found.items.find((c) => c.email === email)!.id;
  await request.patch(`${API_URL}/creators/${id}`, { headers: staff, data: { status: "active", display_name: "Asha Rao" } });

  await page.goto(`${CREATOR_URL}/profile#bank-details`);
  await page.reload(); // same page, new approval: read it again
  const card = page.locator("#bank-details");
  await expect(card.getByRole("button", { name: "Send bank details" })).toBeVisible();

  // Wrong details are explained.
  await card.getByLabel("Account holder name").fill("Asha Rao");
  await card.getByLabel("Bank name").fill("HDFC Bank");
  await card.getByLabel("IFSC code").fill("12345678901");
  await card.getByLabel("Account number").fill("50100123456789");
  await card.getByRole("button", { name: "Send bank details" }).click();
  await expect(card.getByRole("alert")).toContainText("IFSC");

  await card.getByLabel("IFSC code").fill("hdfc0001234");
  await card.getByRole("button", { name: "Send bank details" }).click();
  await expect(card.getByText("•••• 6789")).toBeVisible();
  await expect(card.getByText("HDFC0001234")).toBeVisible();
  await expect(card.getByTestId("bank-status")).toContainText("The WishTrip team will confirm them shortly");
  await expect(card.getByText("50100123456789")).toHaveCount(0); // the number is never shown back

  // Staff confirm: the creator sees the account is active.
  await request.post(`${API_URL}/creators/${id}/bank-details/confirm`, { headers: staff });
  await page.reload();
  await expect(page.locator("#bank-details").getByTestId("bank-status")).toContainText("Your account is active");
});
