// The creator application's WhatsApp field: country picker, validation, international format.
// The submit is intercepted, so no test applications land in the database.
import { expect, test } from "@playwright/test";


test("WhatsApp number: pick a country, validate, send in international format", async ({ page }) => {
  // Server and browser must render the same form (country names once caused a hydration error).
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const sent: unknown[] = [];
  await page.route("**/creators/apply", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, contentType: "application/json", body: "{}" });
  });

  await page.goto("/creators");
  const form = page.locator("form").filter({ hasText: "Apply to join" });
  const code = form.getByLabel("Country code");
  const number = form.getByLabel("WhatsApp number");

  await expect(code).toHaveValue("IN");
  await expect(form.getByText("+91", { exact: true })).toBeVisible();
  // Baseline: the card's size as a visitor first sees it.
  const card = form.locator("..");
  const before = (await card.boundingBox())!;

  // A pasted international number switches the country.
  await number.fill("+44 7400 123456");
  await number.blur();
  await expect(code).toHaveValue("GB");
  await expect(form.getByText("+44", { exact: true })).toBeVisible();
  await expect(number).toHaveValue("07400 123456");

  // Pick a country from the list.
  await code.selectOption("AE");
  await expect(form.getByText("+971", { exact: true })).toBeVisible();

  // Fill the rest; an invalid number is refused before anything is sent.
  await form.getByPlaceholder("e.g. Meera Kamat").fill("Test Creator");
  await form.getByPlaceholder("you@example.com").fill("test.creator@example.com");
  await code.selectOption("IN");
  await number.fill("12345");
  await form.getByRole("button", { name: "Apply to join" }).click();
  await expect(form.getByText("That doesn't look like a valid WhatsApp number for India.")).toBeVisible();
  expect(sent).toHaveLength(0);

  // A valid number goes out in international format.
  await number.fill("98765 43210");
  await form.getByRole("button", { name: "Apply to join" }).click();
  const confirmation = page.getByRole("status").filter({ hasText: "You’re on the list" });
  await expect(confirmation).toBeVisible();
  expect(sent).toHaveLength(1);
  expect((sent[0] as { whatsapp: string }).whatsapp).toBe("+919876543210");

  // The card keeps its size, and the confirmation sits in the middle of it.
  const after = (await card.boundingBox())!;
  expect(Math.round(after.height)).toBe(Math.round(before.height));
  const message = (await confirmation.locator("h3").boundingBox())!;
  const cardMiddle = after.y + after.height / 2;
  expect(Math.abs(message.y + message.height / 2 - cardMiddle)).toBeLessThan(60);
  // The hidden form can't be tabbed into or read out.
  await expect(form).toBeHidden();
  await page.screenshot({ path: process.env.SHOT ?? "test-results/creators-applied.png", fullPage: false });
  expect(pageErrors).toEqual([]);
});
