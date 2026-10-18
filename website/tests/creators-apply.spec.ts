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
  await form.getByLabel("Instagram handle or link").fill("@test.creator");
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


test.describe("Channels: Instagram, YouTube, or both", () => {
  async function fill(page: import("@playwright/test").Page, channels: { instagram?: string; youtube?: string }) {
    const sent: Record<string, string>[] = [];
    await page.route("**/creators/apply", async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 202, contentType: "application/json", body: "{}" });
    });
    await page.goto("/creators");
    const form = page.locator("form").filter({ hasText: "Apply to join" });
    await form.getByPlaceholder("e.g. Meera Kamat").fill("Test Creator");
    await form.getByPlaceholder("you@example.com").fill("channels@example.com");
    if (channels.instagram) await form.getByLabel("Instagram handle or link").fill(channels.instagram);
    if (channels.youtube) await form.getByLabel("YouTube channel link or @handle").fill(channels.youtube);
    await form.getByRole("button", { name: "Apply to join" }).click();
    return { form, sent };
  }

  test("the form asks for both channels, each marked with its own icon", async ({ page }) => {
    await page.goto("/creators");
    const form = page.locator("form").filter({ hasText: "Apply to join" });
    await expect(form.getByText("YOUR CHANNELS")).toBeVisible();
    await expect(form.getByText("Add Instagram, YouTube, or both.")).toBeVisible();
    const instagram = form.getByLabel("Instagram handle or link");
    const youtube = form.getByLabel("YouTube channel link or @handle");
    await expect(instagram).toBeVisible();
    await expect(youtube).toBeVisible();
    // Each field sits in a row with its platform's mark in front of it.
    for (const field of [instagram, youtube]) {
      await expect(field.locator("xpath=..").locator("svg")).toHaveCount(1);
    }
    // And it is no longer a single "Instagram or YouTube" field.
    await expect(form.getByText("INSTAGRAM OR YOUTUBE")).toHaveCount(0);
  });

  test("neither channel is refused before anything is sent", async ({ page }) => {
    const { form, sent } = await fill(page, {});
    await expect(form.getByText("Add your Instagram, your YouTube, or both")).toBeVisible();
    expect(sent).toHaveLength(0);
  });

  test("Instagram alone is enough", async ({ page }) => {
    const { sent } = await fill(page, { instagram: "@meera.travels" });
    await expect(page.getByRole("status").filter({ hasText: "You’re on the list" })).toBeVisible();
    expect(sent[0]).toMatchObject({ handle: "@meera.travels", youtube: "" });
  });

  test("YouTube alone is enough", async ({ page }) => {
    const { sent } = await fill(page, { youtube: "@meeratravels" });
    await expect(page.getByRole("status").filter({ hasText: "You’re on the list" })).toBeVisible();
    expect(sent[0]).toMatchObject({ handle: "", youtube: "@meeratravels" });
  });

  test("both can be given together", async ({ page }) => {
    const { sent } = await fill(page, { instagram: "@meera.travels", youtube: "youtube.com/@meeratravels" });
    await expect(page.getByRole("status").filter({ hasText: "You’re on the list" })).toBeVisible();
    expect(sent[0]).toMatchObject({ handle: "@meera.travels", youtube: "youtube.com/@meeratravels" });
  });

  test("a channel the server rejects shows its message and keeps the form", async ({ page }) => {
    await page.route("**/creators/apply", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Paste your YouTube channel link, or your @handle." }),
      }),
    );
    await page.goto("/creators");
    const form = page.locator("form").filter({ hasText: "Apply to join" });
    await form.getByPlaceholder("e.g. Meera Kamat").fill("Test Creator");
    await form.getByPlaceholder("you@example.com").fill("channels@example.com");
    await form.getByLabel("YouTube channel link or @handle").fill("https://example.com/x");
    await form.getByRole("button", { name: "Apply to join" }).click();
    await expect(form.getByText("Paste your YouTube channel link, or your @handle.")).toBeVisible();
    await expect(form.getByLabel("YouTube channel link or @handle")).toHaveValue("https://example.com/x");
  });
});
