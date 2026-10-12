import { expect, test, watchConsoleErrors } from "../fixtures/test";

test.describe.configure({ timeout: 300_000 });

test("chat check", async ({ page, chatPage, apiLog }) => {
  const errors = watchConsoleErrors(page);
  await chatPage.goto();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/private/tmp/claude-501/-Users-santosh-Development-wish-trip/8388ce8c-9e6d-4553-856c-8c9b77b21786/scratchpad/chat-empty.png", fullPage: true });

  await chatPage.newTrip.click();
  const t0 = Date.now();
  await chatPage.ask("Plan 3 relaxed days in Kerela for my parents, they love tea gardens");
  console.log(`    [turn 1] ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "/private/tmp/claude-501/-Users-santosh-Development-wish-trip/8388ce8c-9e6d-4553-856c-8c9b77b21786/scratchpad/chat-reply.png", fullPage: true });

  // Every transparency panel the demo opens.
  for (const panel of ["Understood intent", "Knowledge base sources", "What the AI was given"]) {
    await page.getByText(panel).first().click();
    await expect(page.getByText(panel).first()).toBeVisible();
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/private/tmp/claude-501/-Users-santosh-Development-wish-trip/8388ce8c-9e6d-4553-856c-8c9b77b21786/scratchpad/chat-panels.png", fullPage: true });

  const t1 = Date.now();
  await chatPage.ask("make it 4 days and we would rather be out in the evenings");
  console.log(`    [turn 2] ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  await expect(chatPage.tripSummary.getByText("Kerala")).toBeVisible();

  console.log(`    [errors] ${JSON.stringify(apiLog.filter((c) => c.status >= 400))}`);
  errors.expectNone();
});
