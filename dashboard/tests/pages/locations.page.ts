import { expect, type Locator, type Page } from "@playwright/test";

import { BasePage } from "./base.page";

export class LocationsPage extends BasePage {
  readonly search: Locator;
  readonly typeFilter: Locator;
  readonly statusFilter: Locator;
  readonly sourceFilter: Locator;
  readonly verificationFilter: Locator;
  readonly rows: Locator;

  constructor(page: Page) {
    super(page);
    this.search = page.getByPlaceholder("Search by name or summary");
    this.typeFilter = page.getByRole("combobox", { name: "Type", exact: true });
    this.statusFilter = page.getByRole("combobox", { name: "Status", exact: true });
    this.sourceFilter = page.getByRole("combobox", { name: "Source", exact: true });
    this.verificationFilter = page.getByRole("combobox", { name: "Verification", exact: true });
    this.rows = page.locator("tbody tr");
  }

  async goto() {
    await this.page.goto("/locations");
    await expect(this.heading("Locations")).toBeVisible();
  }

  row(name: string) {
    return this.rows.filter({ has: this.page.getByRole("link", { name, exact: true }) });
  }
}
