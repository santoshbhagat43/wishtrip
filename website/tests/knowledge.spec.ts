/**
 * Knowledge → plan @knowledge @demo — the core promise, end to end, across both apps:
 *
 *   1. Staff add a place with local knowledge in the dashboard and publish it.
 *   2. It is embedded (the dashboard shows "Indexed for AI").
 *   3. A traveler types one sentence on the website: the intent is understood, the knowledge
 *      base is searched by meaning, and the plan is built from WishTrip's own places first —
 *      including the new one and the staff's tip, under the data-honesty rules.
 *   4. A destination the knowledge base doesn't cover still gets an answer, labelled as general.
 *
 *   pnpm test:knowledge            (headed: watch the dashboard, then the website)
 *   pnpm test:knowledge:headless
 *
 * Needs the stack running (docker compose up -d) and ADMIN_EMAIL / ADMIN_PASSWORD in ../.env.
 * The place it creates is named "E2E …" and deleted at the end, even if the test fails.
 */
import type { Browser, Page } from "@playwright/test";

import { expect, signUp, test } from "./fixtures";

test.describe.configure({ timeout: 420_000 });

const DASHBOARD = process.env.DASHBOARD_URL ?? "http://localhost:3001";
const API = process.env.API_URL ?? "http://localhost:8000";
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "", password: process.env.ADMIN_PASSWORD ?? "" };

const PLACE = `E2E Lakshmi Estate sunset walk ${Date.now().toString(36)}`;
const TIP = "Carry a light shawl — it gets cold after 6 pm, and the estate gate closes at 7 pm.";
const ASK = "Plan 2 slow days in Munnar for my parents, they love tea estates and sunset walks";
const UNCOVERED = "Plan 3 days in Reykjavik for a couple";

let createdId: string | null = null;

/** Step 1–2: a staff member adds the knowledge in the dashboard, in its own browser window. */
async function addKnowledgeAsStaff(browser: Browser) {
  expect(ADMIN.email && ADMIN.password, "set ADMIN_EMAIL / ADMIN_PASSWORD in the repo .env").toBeTruthy();
  const context = await browser.newContext({ baseURL: DASHBOARD, viewport: { width: 1440, height: 900 } });
  const staff = await context.newPage();

  await test.step("Staff signs in to the dashboard", async () => {
    await staff.goto("/login");
    await staff.getByLabel("Email").fill(ADMIN.email);
    await staff.getByLabel("Password").fill(ADMIN.password);
    await staff.getByRole("button", { name: "Sign in" }).click();
    await expect(staff.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  });

  await test.step("Staff adds a published place under Munnar", async () => {
    await staff.goto("/locations/new");
    await staff.getByRole("textbox", { name: "Name", exact: true }).fill(PLACE);
    await staff.getByRole("combobox", { name: "Type", exact: true }).selectOption("experience");
    await staff.getByRole("combobox", { name: "Status", exact: true }).selectOption("published");
    const city = staff.getByRole("combobox", { name: "Belongs to (city)" });
    await expect(city.locator("option", { hasText: "Munnar tea hills" })).toHaveCount(1);
    const munnar = await city.locator("option", { hasText: "Munnar tea hills" }).getAttribute("value");
    await city.selectOption(munnar!);
    await staff
      .getByRole("textbox", { name: "Summary", exact: true })
      .fill("Gentle, flat walk along tea rows to a west-facing ridge for sunset over the Munnar hills.");
    await staff
      .getByRole("textbox", { name: "Description", exact: true })
      .fill("A 90-minute guided walk on level estate paths, ending at a viewpoint with benches. Suits older travellers.");
    const created = staff.waitForResponse((r) => r.request().method() === "POST" && /\/locations$/.test(new URL(r.url()).pathname));
    await staff.getByRole("button", { name: "Create" }).click();
    expect((await created).status()).toBe(201);
    await expect(staff.getByRole("heading", { level: 1, name: PLACE })).toBeVisible();
    createdId = staff.url().split("/locations/")[1]?.split(/[?#]/)[0] ?? null;
  });

  const save = async () => {
    const saved = staff.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/locations/"));
    await staff.getByRole("button", { name: "Save changes" }).click();
    expect((await saved).status()).toBe(200);
    await expect(staff.getByRole("button", { name: "Saved" })).toBeVisible();
  };

  await test.step("Staff adds the facts the planner uses: duration, best time, pace", async () => {
    await staff.getByRole("tab", { name: "Travel info" }).click();
    await staff.getByRole("spinbutton", { name: "Duration (minutes)", exact: true }).fill("90");
    await staff.getByRole("button", { name: "evening", exact: true }).click();
    await save();
    await staff.getByRole("tab", { name: "Characteristics" }).click();
    await staff.getByRole("combobox", { name: "Energy level", exact: true }).selectOption("1");
    await save();
  });

  await test.step("Staff adds local knowledge: a pro and an insider tip", async () => {
    await staff.getByRole("tab", { name: "Knowledge & tags" }).click();
    await staff.getByPlaceholder("Great river views").fill("Flat paths with benches along the way");
    await staff.getByRole("button", { name: "Add" }).first().click();
    await staff.getByRole("textbox", { name: "Insider tips", exact: true }).fill(TIP);
    await save();
  });

  await test.step("The place is embedded for the AI (\"Indexed for AI\")", async () => {
    await expect(async () => {
      await staff.reload();
      await expect(staff.getByText("Indexed for AI")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 3_000] });
  });

  await context.close();
}

async function send(page: Page, message: string) {
  const reply = page.waitForResponse((r) => /\/api\/wt\/chat\/sessions\/[^/]+\/messages/.test(r.url()), {
    timeout: 300_000,
  });
  await page.getByPlaceholder(/4 days in Munnar/).fill(message);
  await page.getByRole("button", { name: "Send" }).click();
  const response = await reply;
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe("Knowledge → plan @knowledge @demo", () => {
  test.afterAll(async ({ playwright }) => {
    if (!createdId) return;
    // Clean up through the API so a failed run never leaves a test place in front of travelers.
    const api = await playwright.request.newContext({ baseURL: API });
    const login = await api.post("/auth/login", { data: ADMIN });
    const { access_token } = await login.json();
    const removed = await api.delete(`/admin/locations/${createdId}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect([204, 404]).toContain(removed.status());
    await api.dispose();
  });

  test("staff knowledge reaches a traveler's plan, with intent and the honesty rules", async ({ browser, page }) => {
    await addKnowledgeAsStaff(browser);

    await test.step("A new traveler opens the trip planner on the website", async () => {
      await signUp(page);
      await page.goto("/plan");
      await expect(page.getByRole("heading", { name: "Where to next?" })).toBeVisible();
    });

    const turn = await test.step("They describe the trip in one sentence", () => send(page, ASK));
    const message = turn.assistant_message;

    await test.step("Intent: the sentence is understood", async () => {
      const panel = page.getByRole("complementary").filter({ hasText: "Your trip so far" });
      await expect(panel.getByText("Munnar")).toBeVisible();
      await expect(panel.getByText("2 days")).toBeVisible();
      await expect(panel.getByText(/seniors/i)).toBeVisible(); // "my parents"
      expect(message.intent.intent).toBe("plan_trip");
    });

    await test.step("Knowledge base first: the plan is built from WishTrip's checked places", async () => {
      await expect(page.getByText("From places WishTrip has checked")).toBeVisible();
      // Retrieval (embeddings) found the new place and handed it to the planner...
      expect(message.sources.map((s: { name: string }) => s.name)).toContain(PLACE);
      // ...and it is in the scheduled plan, at its best time of day.
      const planned = message.itinerary.flatMap((d: { items: { name: string; start: string }[] }) => d.items);
      const stop = planned.find((i: { name: string }) => i.name === PLACE);
      expect(stop, "the new place should be scheduled in the plan").toBeTruthy();
      expect(stop.start >= "17:00", `scheduled at ${stop.start}, expected the evening`).toBeTruthy();
      await expect(page.getByRole("link", { name: PLACE })).toBeVisible();
    });

    await test.step("The staff's local knowledge is passed on to the traveler", async () => {
      await expect(page.getByText("Good to know:")).toBeVisible();
      await expect(page.getByText(TIP)).toBeVisible();
    });

    await test.step("Honesty rules: the plan is checked, and no price is invented", async () => {
      await expect(page.getByText(/Checked — /).first()).toBeVisible();
      await expect(page.getByText(/planned · fits/).first()).toBeVisible();
      await expect(page.getByText("not available yet").first()).toBeVisible();
      expect(message.content).not.toMatch(/[₹$£€]\s?\d/);
    });

    await test.step("Not in the knowledge base: still answered, but labelled as general", async () => {
      await page.getByRole("button", { name: "New trip" }).click();
      const general = await send(page, UNCOVERED);
      await expect(page.getByText("General ideas — not from our checked places")).toBeVisible();
      expect(general.assistant_message.sources).toEqual([]);
      // Still a real itinerary: day by day, with times of day, labelled as unchecked.
      await expect(page.getByText("A general plan.")).toBeVisible();
      await expect(page.getByText(/^Day 1/).first()).toBeVisible();
      await expect(page.getByText(/^(Morning|Afternoon|Evening)$/i).first()).toBeVisible();
      const days = new Set(general.assistant_message.suggestions.map((s: { day: number | null }) => s.day).filter(Boolean));
      expect(days.size, "a 3-day request should give 3 planned days").toBe(3);
      await expect(page.getByText("not available yet").first()).toBeVisible();
    });
  });
});
