import { expect, type Locator, type Page } from "@playwright/test";

import { BasePage } from "./base.page";

export class LocationPage extends BasePage {
  readonly saveButton: Locator;
  readonly deleteButton: Locator;

  constructor(page: Page) {
    super(page);
    this.saveButton = page.getByRole("button", { name: /Save changes|Saved|Saving/ });
    this.deleteButton = page.getByRole("button", { name: "Delete" });
  }

  tab(name: string) {
    return this.page.getByRole("tab", { name, exact: true });
  }

  /** Text inputs by their label. */
  field(label: string) {
    return this.page.getByRole("textbox", { name: label, exact: true });
  }

  number(label: string) {
    return this.page.getByRole("spinbutton", { name: label, exact: true });
  }

  select(label: string) {
    return this.page.getByRole("combobox", { name: label, exact: true });
  }

  async save() {
    const response = this.page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/admin/locations/"));
    await this.page.getByRole("button", { name: "Save changes" }).click();
    expect((await response).status()).toBe(200);
    await expect(this.page.getByRole("button", { name: "Saved" })).toBeVisible();
  }

  async deleteWithConfirm() {
    this.page.once("dialog", (dialog) => dialog.accept());
    await this.deleteButton.click();
    await expect(this.page).toHaveURL(/\/locations$/);
  }
}
