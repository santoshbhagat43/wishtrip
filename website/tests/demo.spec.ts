/**
 * Demo rehearsal @demo — walks Acts 2, 3 and 6 of docs/DEMO.md in order, with the exact
 * prompts from the run sheet. Run it before the client meeting: green means every screen
 * you plan to show works, and the model is warm.
 *
 *   pnpm test:demo            (headed, so you watch what they'll see)
 *   pnpm test:demo:headless
 */
import { expect, signUp, test } from "./fixtures";

// Grok 4.3 answers in 7–9s; local gemma4 takes ~35s. Leave room for either.
test.describe.configure({ timeout: 420_000 });

const PLAN = "Plan 3 relaxed days in Kerela for my parents, they love tea gardens";
const MODIFY = "actually make it 4 days from 10 December, and we would rather be out in the evenings";
const CLEAR = "dates are flexible now";
const UNCOVERED = "Plan 3 days in Reykjavik for a couple";

/** The right-hand "Your trip so far" panel — the intent surface in Act 2. */
const tripPanel = (page: import("@playwright/test").Page) =>
  page.getByRole("complementary").filter({ hasText: "Your trip so far" });

async function send(page: import("@playwright/test").Page, message: string) {
  const reply = page.waitForResponse((r) => /\/api\/wt\/chat\/sessions\/[^/]+\/messages/.test(r.url()), {
    timeout: 300_000,
  });
  await page.getByPlaceholder(/4 days in Munnar/).fill(message);
  await page.getByRole("button", { name: "Send" }).click();
  expect((await reply).status()).toBe(200);
}

test.describe("Demo @demo", () => {
  test("Act 2 + 3: one sentence becomes a checked trip, and the data stays honest", async ({ page }) => {
    await signUp(page);
    await page.goto("/plan");
    await expect(page.getByRole("heading", { name: "Where to next?" })).toBeVisible();

    // --- Act 2, turn 1: intent out of one typo-ridden sentence.
    await send(page, PLAN);

    const panel = tripPanel(page);
    await expect(panel.getByText("Kerala")).toBeVisible(); // "Kerela" typo-corrected
    await expect(panel.getByText("3 days")).toBeVisible();
    await expect(panel.getByText(/seniors/i)).toBeVisible(); // "my parents"
    await expect(panel.getByText(/tea gardens/i)).toBeVisible();
    await expect(panel.getByText(/\(1\/5\)/)).toBeVisible(); // "relaxed" → pace 1 of 5

    // --- Act 3: how the answer is presented.
    await expect(page.getByText("From places WishTrip has checked")).toBeVisible();
    await expect(page.getByText(/Checked — /)).toBeVisible(); // feasibility verdict on the plan
    await expect(page.getByText(/^Day 1/).first()).toBeVisible();
    await expect(page.getByText(/planned · fits/).first()).toBeVisible(); // day load vs capacity
    await expect(page.getByText("not available yet").first()).toBeVisible(); // never an invented price

    // --- Act 2, turn 2: the session carries the trip; new details merge in.
    await send(page, MODIFY);
    await expect(panel.getByText("4 days")).toBeVisible();
    await expect(panel.getByText(/evening/i)).toBeVisible();
    await expect(panel.getByText(/10 Dec 2026|Dec 10, 2026/)).toBeVisible();
    await expect(panel.getByText("Kerala")).toBeVisible(); // not re-stated, not lost
    await expect(panel.getByText(/seniors/i)).toBeVisible();

    // --- Act 2, turn 3: a traveller can take a detail back (cleared_fields).
    await send(page, CLEAR);
    await expect(panel.getByText(/10 Dec 2026|Dec 10, 2026/)).toBeHidden();
    await expect(panel.getByText("Kerala")).toBeVisible();
    await expect(panel.getByText("4 days")).toBeVisible();

    // --- Act 6: booking is honest about not existing yet.
    await page.getByRole("button", { name: "Book this trip" }).first().click();
    await expect(page.getByRole("dialog", { name: "Booking" })).toContainText("Booking isn't live yet");
  });

  test("Act 2: a destination we don't cover is labelled, not bluffed", async ({ page }) => {
    await signUp(page);
    await page.goto("/plan");
    await send(page, UNCOVERED);

    await expect(page.getByText("General ideas — not from our checked places")).toBeVisible();
    await expect(page.getByText(/Checked — /)).toBeHidden();
    await expect(page.getByText("not available yet").first()).toBeVisible();
  });

  test("Act 3 + 6: explore pages show checked facts, and unbuilt inputs say so", async ({ page }) => {
    // No LLM on this path — it's the fast proof that the honesty rules hold outside chat.
    // Explore works signed out; /plan needs an account, so sign up first.
    await signUp(page);
    await page.goto("/explore");
    await expect(page.getByRole("heading", { name: "Explore destinations" })).toBeVisible();
    await page.getByRole("link", { name: /Munnar tea hills/ }).click();
    await page.getByRole("link", { name: /tea gardens/i }).first().click();
    await expect(page.getByText("How long")).toBeVisible();
    await expect(page.getByText("not available yet")).toBeVisible();

    // The two intent modes that aren't built are labelled in the UI, not hidden.
    await page.goto("/plan");
    await page.getByRole("tab", { name: "Paste a link" }).click();
    await expect(page.getByText(/Coming soon — we can.t read reels/)).toBeVisible();
    await page.getByRole("tab", { name: "Screenshot" }).click();
    await expect(page.getByText(/Coming soon — planning from a screenshot/)).toBeVisible();
  });
});
