/**
 * "Chat with Arya" on a trip made for the traveller: the chat opens already holding the board, and
 * its first message (the board in words) is sent for them. The trip and the chat's answers are
 * canned so the test checks the hand-over, not the planner.
 */
import { expect, signUp, test } from "./fixtures";

const CODE = "abcd2345";
const SESSION = "11111111-2222-3333-4444-555555555555";
const BOARD = "This is my trip board for Bali: 4 days, 2 adults, relaxed pace. Day 1: Tanah Lot.";

test("Chat with Arya opens the chat with the board, and sends it once", async ({ page }) => {
  await signUp(page);
  await page.route(`**/api/wt/my-trips/${CODE}`, (route) =>
    route.fulfill({
      json: {
        code: CODE, source_share_code: "goa-aaaaaa", title: "Bali trip", destination_name: "Bali", summary: "", cover_image_url: null,
        creator: { handle: "e2ecreator", display_name: "E2E Creator", referral_code: "e2ecreator" },
        items: [{ id: "s1", kind: "sight", name: "Tanah Lot", note: "", day: 1, origin: "reel", verified: true }],
        adults: 2, kids: 0, seniors: 0, days: 4, pace: "relaxed", when: "", group: "couple",
        build_status: "ready", build_error: "", persona: "couple", ai_built: false, plan_summary: "", tips: [], import_id: null,
      },
    }),
  );
  await page.route(`**/api/wt/trips/goa-aaaaaa`, (route) => route.fulfill({ status: 404, json: { detail: "no" } }));
  await page.route(`**/api/wt/my-trips/${CODE}/arya`, (route) => route.fulfill({ status: 201, json: { session_id: SESSION, message: BOARD } }));
  const chatState = { id: SESSION, title: "Bali trip", state: { destination: "Bali", duration_days: 4, companions: "couple", my_trip: CODE }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), messages: [] };
  await page.route(`**/api/wt/chat/sessions/${SESSION}`, (route) => route.fulfill({ json: chatState }));
  const sent: string[] = [];
  await page.route(`**/api/wt/chat/sessions/${SESSION}/messages`, (route) => {
    sent.push(route.request().postDataJSON().content);
    return route.fulfill({ status: 500, json: { detail: "not in this test" } });
  });

  await page.goto(`/trip/mine/${CODE}`);
  await page.getByRole("button", { name: /Ask Arya to change anything/ }).click();
  await expect(page).toHaveURL(new RegExp(`/arya\\?session=${SESSION}$`));
  await expect.poll(() => sent).toEqual([BOARD]); // sent for them, with the board in it
  await expect(page.getByRole("link", { name: "Open full board" })).toHaveAttribute("href", `/trip/mine/${CODE}`);
  await expect(page.getByRole("complementary", { name: "What Arya knows" })).toContainText("Bali");

  await page.reload();
  await expect(page.getByRole("link", { name: "Open full board" })).toBeVisible();
  expect(sent).toHaveLength(1); // a reload doesn't send it again
});
