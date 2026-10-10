import { expect, type Locator, type Page } from "@playwright/test";

export abstract class BasePage {
  constructor(readonly page: Page) {}

  heading(name: string | RegExp): Locator {
    return this.page.getByRole("heading", { level: 1, name });
  }

  async openFromSidebar(label: string, heading: string | RegExp) {
    await this.page.getByRole("navigation").getByRole("link", { name: label, exact: true }).click();
    await expect(this.heading(heading)).toBeVisible();
  }
}
