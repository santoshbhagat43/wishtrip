import { expect, test, watchConsoleErrors } from "../fixtures/test";

test.describe("Trip chat (works without an OpenRouter key)", () => {
  // With LLM_PROVIDER=ollama each turn runs gemma4 locally, which can take ~30s.
  test.describe.configure({ timeout: 240_000 });
  test("answers from the knowledge base and never invents prices", async ({ page, chatPage }) => {
    const console = watchConsoleErrors(page);
    await chatPage.goto();
    await chatPage.newTrip.click();
    await chatPage.ask("Plan 4 relaxed days in Kerala for a couple who love nature");

    await expect(page.getByText(/From WishTrip knowledge base|Partly general knowledge/).first()).toBeVisible();
    // Every suggestion shows a verified price or an explicit "not available yet".
    await expect(page.getByText("not available yet").first()).toBeVisible();
    // With an LLM the plan is checked and shown as a timeline; without one, as suggestion cards.
    const planCheck = page.getByText(/Plan check(ed)? —/).first();
    await expect(planCheck.or(page.getByText("Knowledge base", { exact: true }).first()).first()).toBeVisible();
    if (await planCheck.isVisible()) {
      await expect(page.getByText(/^Day 1/).first()).toBeVisible();
      await expect(page.getByText(/ of \d+ h/).first()).toBeVisible(); // day load vs capacity
    }

    // The trip state picked up the destination.
    await expect(chatPage.tripSummary.getByText("Kerala")).toBeVisible();

    // Transparency panels
    await page.getByText(/Knowledge base sources/).click();
    await expect(page.getByText("K1", { exact: true })).toBeVisible();
    await page.getByText("What the AI was given").click();
    await expect(page.getByText(/KNOWLEDGE BASE:/)).toBeVisible();

    // Follow-up continues the same conversation and keeps context.
    await chatPage.ask("we prefer evenings");
    await expect(chatPage.tripSummary.getByText(/evening/i)).toBeVisible();
    await expect(chatPage.tripSummary.getByText("Kerala")).toBeVisible();

    // Clean up the conversation
    // The newest conversation is first in the list.
    const conversation = page.getByRole("button", { name: /Plan 4 relaxed days/ }).first();
    page.once("dialog", (d) => d.accept());
    await conversation.hover();
    await conversation.locator("svg").last().click();
    console.expectNone();
  });

  test("a destination we don't cover is labelled general knowledge", async ({ page, chatPage }) => {
    await chatPage.goto();
    await chatPage.newTrip.click();
    await chatPage.ask("Plan 3 days in Reykjavik for a couple");
    await expect(page.getByText("General knowledge — not in our knowledge base")).toBeVisible();
    await expect(page.getByText(/Knowledge base sources/)).toBeHidden();
  });
});
