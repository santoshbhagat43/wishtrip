/**
 * The home page's "Start planning" panel: nothing floats over it, "Plan it with Arya" shows only
 * once something is typed, and it takes those words to /arya.
 */
import { SSO_URL, expect, test } from "./fixtures";

const SSO_LOGIN = new RegExp(`^${SSO_URL}/sso/login`);
const TEXT = "Goa in December with my parents. Mum can't walk much.";

for (const [name, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test.describe(`Start planning on the home page (${name})`, () => {
    test.use({ viewport });

    test("the scroll hint steps aside, and Plan it with Arya needs words", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Start planning" }).filter({ visible: true }).click();
      const panel = page.getByRole("dialog", { name: "Start planning" }).filter({ visible: true });
      await expect(panel).toBeVisible();

      // Nothing is drawn over the panel: whatever is on top at its middle belongs to it.
      const topmostIsPanel = await panel.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 120));
        return !!hit && el.contains(hit);
      });
      expect(topmostIsPanel).toBe(true);
      // (the hint's wrapper carries the opacity)
      await expect(page.getByText("Scroll to bring it together").filter({ visible: true }).locator("xpath=..")).toHaveCSS("opacity", "0");

      // Empty, or only spaces: no button, and Enter goes nowhere.
      const box = panel.getByLabel(/Tell Arya in your own words/);
      await expect(panel.getByRole("button", { name: /Plan it with Arya/ })).toHaveCount(0);
      await box.fill("   ");
      await expect(panel.getByRole("button", { name: /Plan it with Arya/ })).toHaveCount(0);
      await box.press("Enter");
      await expect(page).not.toHaveURL(/arya|sso/);

      // An idea fills the box (so the button appears), and the text can still be changed.
      await panel.getByRole("button", { name: /Goa with a toddler/ }).click();
      await expect(box).toHaveValue(/Goa with a toddler/);
      await expect(panel.getByRole("button", { name: /Plan it with Arya/ })).toBeVisible();
      await box.fill("");
      await expect(panel.getByRole("button", { name: /Plan it with Arya/ })).toHaveCount(0);

      // With words, the button appears and goes to Arya carrying them.
      await box.fill(TEXT);
      await panel.getByRole("button", { name: /Plan it with Arya/ }).click();
      // Signed out, the proxy sends them to sign in and brings them back to /arya with the words.
      await expect(page).toHaveURL(SSO_LOGIN);
      const back = new URL(new URL(page.url()).searchParams.get("redirect")!);
      expect(back.pathname).toBe("/arya");
      expect(back.searchParams.get("prompt")).toBe(TEXT);
    });

    test("Enter sends the typed words too", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Start planning" }).filter({ visible: true }).click();
      const panel = page.getByRole("dialog", { name: "Start planning" }).filter({ visible: true });
      await panel.getByLabel(/Tell Arya in your own words/).fill(TEXT);
      await panel.getByLabel(/Tell Arya in your own words/).press("Enter");
      await expect(page).toHaveURL(SSO_LOGIN);
      expect(new URL(new URL(page.url()).searchParams.get("redirect")!).searchParams.get("prompt")).toBe(TEXT);
    });
  });
}
