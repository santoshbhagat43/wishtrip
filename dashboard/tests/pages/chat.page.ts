import { expect, type Locator, type Page } from "@playwright/test";

import { BasePage } from "./base.page";

export class ChatPage extends BasePage {
  readonly input: Locator;
  readonly send: Locator;
  readonly newTrip: Locator;
  readonly tripSummary: Locator;

  constructor(page: Page) {
    super(page);
    this.input = page.getByPlaceholder("Where do you want to go, with whom, and what do you love?");
    this.send = page.getByRole("button", { name: "Send" });
    this.newTrip = page.getByRole("button", { name: "New trip" });
    this.tripSummary = page.getByRole("complementary").filter({ hasText: "Trip so far" });
  }

  async goto() {
    await this.page.goto("/chat");
    await expect(this.input).toBeVisible();
  }

  async ask(message: string) {
    const reply = this.page.waitForResponse((r) => /\/chat\/sessions\/[^/]+\/messages/.test(r.url()), { timeout: 180_000 });
    await this.input.fill(message);
    await this.send.click();
    expect((await reply).status()).toBe(200);
  }
}
