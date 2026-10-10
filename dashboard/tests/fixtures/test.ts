import { test as base, expect, type Page } from "@playwright/test";

import { ChatPage } from "../pages/chat.page";
import { LocationPage } from "../pages/location.page";
import { LocationsPage } from "../pages/locations.page";

type ApiCall = { method: string; path: string; status: number; ms: number };

type Fixtures = {
  apiLog: ApiCall[];
  locationsPage: LocationsPage;
  locationPage: LocationPage;
  chatPage: ChatPage;
};

/**
 * Every dashboard test records the backend calls the page makes (through /api/backend),
 * prints them live in the terminal and attaches them to the HTML report, so you can watch
 * the UI and the API side by side.
 */
export const test = base.extend<Fixtures>({
  apiLog: async ({ page }, use, testInfo) => {
    const calls: ApiCall[] = [];
    const started = new Map<string, number>();
    page.on("request", (req) => {
      if (req.url().includes("/api/")) started.set(req.url() + req.method(), Date.now());
    });
    page.on("response", (res) => {
      const req = res.request();
      const url = new URL(res.url());
      if (!url.pathname.startsWith("/api/")) return;
      const path = url.pathname.replace(/^\/api\/backend/, "") + url.search;
      const ms = Date.now() - (started.get(req.url() + req.method()) ?? Date.now());
      calls.push({ method: req.method(), path, status: res.status(), ms });
      const flag = res.status() >= 400 ? "✗" : "→";
      console.log(`    ${flag} ${req.method().padEnd(6)} ${path}  ${res.status()}  ${ms}ms`);
    });
    await use(calls);
    await testInfo.attach("api-calls.json", {
      body: JSON.stringify(calls, null, 2),
      contentType: "application/json",
    });
  },
  locationsPage: async ({ page, apiLog: _ }, use) => use(new LocationsPage(page)),
  locationPage: async ({ page, apiLog: _ }, use) => use(new LocationPage(page)),
  chatPage: async ({ page, apiLog: _ }, use) => use(new ChatPage(page)),
});

/** Fail the test if the page logged a JavaScript error (e.g. a React crash). */
export function watchConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return {
    expectNone: () => expect(errors, `page errors: ${errors.join("\n")}`).toEqual([]),
  };
}

export { expect };
