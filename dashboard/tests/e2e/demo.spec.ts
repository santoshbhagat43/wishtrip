/**
 * Demo rehearsal @demo — walks Acts 4, 5 and 6 of docs/DEMO.md in order: the transparency
 * panels that prove the pipeline, the knowledge-base scale, and the editorial loop.
 * Run it before the client meeting.
 *
 *   pnpm test:demo            (headed, so you watch what they'll see)
 *   pnpm test:demo:headless
 */
import type { Page } from "@playwright/test";

import type { LocationsPage } from "../pages/locations.page";
import { expect, test, watchConsoleErrors } from "../fixtures/test";

const PLACE = "Munnar tea gardens & Tea Museum";
const MARKER = " Checked ahead of the client demo.";
const FALLBACK_SUMMARY = "Rolling emerald slopes, tea tasting.";

/**
 * Open a place by name. Filtering through the search box re-renders the table under the
 * pointer and the click gets lost, so filter through the URL (the list reads `q` on mount)
 * and retry the click until the detail page is actually open.
 */
async function openPlace(page: Page, _locations: LocationsPage, name: string) {
  await page.goto(`/locations?q=${encodeURIComponent(name)}`);
  const link = page.getByRole("link", { name, exact: true });
  await expect(link).toBeVisible();
  await expect(async () => {
    await link.click();
    await page.waitForURL(/\/locations\/[0-9a-f-]{36}/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test.describe("Demo @demo", () => {
  // Grok 4.3 answers in 7–9s; local gemma4 takes ~35s. Leave room for either.
  test.describe.configure({ timeout: 300_000 });

  test("Act 4: the chat shows its work — intent, sources, the exact prompt", async ({ page, chatPage }) => {
    const console = watchConsoleErrors(page);
    await chatPage.goto();
    await chatPage.newTrip.click();
    await chatPage.ask("Plan 3 relaxed days in Kerela for my parents, they love tea gardens");

    // The answer is grounded and priced honestly.
    await expect(page.getByText(/From WishTrip knowledge base|Partly general knowledge/).first()).toBeVisible();
    await expect(page.getByText("not available yet").first()).toBeVisible();

    // The trip state picked up the typo-corrected destination.
    await expect(chatPage.tripSummary.getByText("Kerala")).toBeVisible();

    // Panel 1: the structured intent behind the reply.
    await page.getByText("Understood intent").click();
    await expect(page.getByText(/"destination"|destination/).first()).toBeVisible();

    // Panel 2: the knowledge-base records the reply cites.
    await page.getByText(/Knowledge base sources/).click();
    // (The reply's own [K1] citations are links too; check the sources list itself.)
    await expect(page.locator("details").getByText("K1", { exact: true }).first()).toBeVisible();

    // Panel 3: everything the model was given — no hidden prompt.
    await page.getByText("What the AI was given").click();
    await expect(page.getByText(/KNOWLEDGE BASE:/)).toBeVisible();
    await expect(page.getByText(/TRAVELER INTENT:/)).toBeVisible();

    // The plan carries a deterministic check, not a model opinion.
    const planCheck = page.getByText(/Plan check(ed)? —/).first();
    if (await planCheck.isVisible()) {
      await expect(page.getByText(/^Day 1/).first()).toBeVisible();
      await expect(page.getByText(/ of \d+ h/).first()).toBeVisible(); // day load vs capacity
    }

    // Clean up the conversation we created.
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /^Delete conversation: Plan 3 relaxed days/ }).first().click();
    console.expectNone();
  });

  test("Act 5: the knowledge base is real, and the hierarchy holds", async ({ page, apiLog }) => {
    await page.goto("/");
    for (const label of ["Places", "Cities", "Published", "Drafts"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    // Unverified imports are held back as drafts rather than shown to travellers.
    await expect(page.getByText(/to verify/)).toBeVisible();
    await expect(page.getByText(/Chat model/)).toBeVisible();

    // country → city → place, the shape the schema enforces.
    await page.goto("/destinations");
    await page.getByRole("link", { name: /^India/ }).click();
    await page.getByRole("link", { name: /^Munnar tea hills/ }).click();
    await page.getByRole("tab", { name: /Experiences/ }).click();
    await expect(page.getByRole("link", { name: /tea gardens/i })).toBeVisible();

    expect(apiLog.filter((c) => c.status >= 500), "no server errors").toEqual([]);
  });

  test("Act 4: the back office — review queue, destinations, menus, support, routing", async ({ page }) => {
    // Review queue: the badge, the filters and a record with its checks.
    await page.goto("/review");
    await expect(page.getByRole("heading", { level: 1, name: "Review queue" })).toBeVisible();
    await expect(page.getByRole("button", { name: /To verify/ })).toBeVisible();
    await expect(page.getByText("Automatic checks")).toBeVisible();
    await expect(page.getByText("The editorial backlog")).toBeVisible();

    // Destinations: countries first, then their cities with what each holds.
    await page.goto("/destinations");
    await expect(page.getByRole("heading", { level: 1, name: "Destinations" })).toBeVisible();
    await page.getByRole("link", { name: /^India/ }).click();
    await expect(page.getByRole("link", { name: /^Goa/ })).toBeVisible();

    // Menus: the traveller site's navigation, editable here.
    await page.goto("/menus");
    await expect(page.getByRole("heading", { level: 1, name: "Menus" })).toBeVisible();
    await expect(page.getByText("Main navigation")).toBeVisible();

    // Support inbox: someone in destination sorts to the top.
    await page.goto("/support");
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
    await expect(page.getByText("In destination").first()).toBeVisible();
    await expect(page.getByText(/median first reply/)).toBeVisible();
    await expect(page.getByText("Internal note")).toBeVisible();

    // Routing: a named agent is up next, with the reason.
    await page.getByRole("link", { name: "Routing", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Routing" })).toBeVisible();
    await expect(page.getByText("Next new ticket goes to")).toBeVisible();
    await expect(page.getByRole("button", { name: "Assign a test ticket" })).toBeVisible();

    // Roles and system health, both read from the live system.
    await page.goto("/roles");
    await expect(page.getByText("Permission matrix")).toBeVisible();
    await page.goto("/system");
    await expect(page.getByText("x-ai/grok-4.3").first()).toBeVisible();
  });

  test("Act 6: staff edit the knowledge, and search picks it up", async ({ page, locationsPage, locationPage }) => {
    const console = watchConsoleErrors(page);

    // Edit a published place: this is the loop that improves the AI without a deploy.
    // The marker is a plain sentence, and it's always restored — a half-finished run must never
    // leave a demo record looking edited.
    await openPlace(page, locationsPage, PLACE);
    const summary = locationPage.field("Summary");
    const original = ((await summary.inputValue()) || FALLBACK_SUMMARY).replace(MARKER, "").trim();
    try {
      await summary.fill(`${original}${MARKER}`);
      await locationPage.save();

      // Semantic search is how the chat retrieves — same index, same path.
      await page.goto("/search");
      await page.getByPlaceholder("quiet sunset spot for a couple").fill("tea gardens tasting");
      await page.keyboard.press("Enter");
      await expect(page.getByText(/Embeddings:/)).toBeVisible();
      await expect(page.getByRole("link", { name: /tea gardens/i }).first()).toBeVisible();
    } finally {
      await openPlace(page, locationsPage, PLACE);
      await locationPage.field("Summary").fill(original);
      await locationPage.save();
    }

    // Imported hotels stay staff-only until someone verifies them.
    await page.goto("/locations?type=hotel&needs_verification=true");
    const hotel = locationsPage.rows.first().getByRole("link").first();
    await expect(hotel).toBeVisible();
    await expect(async () => {
      await hotel.click();
      await page.waitForURL(/\/locations\/[0-9a-f-]{36}/, { timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    await locationPage.tab("Source").click();
    await expect(page.getByText("Reference data — unverified, staff only")).toBeVisible();

    // Every edit above is attributable.
    await page.goto("/audit-log");
    await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
    await expect(page.getByText("location").first()).toBeVisible();
    console.expectNone();
  });
});
