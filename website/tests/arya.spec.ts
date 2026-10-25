/**
 * Arya (/arya, the old /plan): the planner in the B4 design. These checks cover the page itself,
 * the redirect from /plan and the parts that need no AI; real conversations are in the
 * knowledge, demo and conversations specs.
 */
import { SSO_URL, expect, signUp, test } from "./fixtures";

const SHOT = process.env.SHOT_DIR;

test.describe("Arya", () => {
  test("/plan is now /arya: old links and prompts keep working, signed-out visitors sign in first", async ({ page, request, baseURL }) => {
    const old = await request.get(`${baseURL}/plan?prompt=Goa%20in%20December`, { maxRedirects: 0 });
    expect(old.status()).toBe(308);
    const to = new URL(old.headers()["location"], baseURL);
    expect(to.pathname).toBe("/arya");
    expect(to.searchParams.get("prompt")).toBe("Goa in December");

    await page.goto("/arya?prompt=Goa%20in%20December");
    await expect(page).toHaveURL(new RegExp(`^${SSO_URL}/sso/login`));
    const back = new URL(new URL(page.url()).searchParams.get("redirect")!);
    expect(back.pathname).toBe("/arya");
    expect(back.searchParams.get("prompt")).toBe("Goa in December");
  });

  test("the page: Arya's chat, the trip board that fills in, and everything honest", async ({ page, baseURL }) => {
    await signUp(page);
    await page.goto("/plan?prompt=Goa%20in%20December"); // the old address, with a prompt
    await expect(page).toHaveURL(new RegExp(`^${baseURL}/arya\\?prompt=Goa(%20|\\+)in(%20|\\+)December$`));

    // The prototype's frame: step tracker, Arya's card, the board beside it.
    await expect(page.getByRole("list", { name: "Progress" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Arya" })).toBeVisible();
    await expect(page.getByText(/never pays without your OK/)).toBeVisible();
    await expect(page.getByText(/Tell me the trip you.re dreaming of/)).toBeVisible();
    await expect(page.getByLabel("Message Arya")).toHaveValue("Goa in December"); // the prompt, ready to send
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();

    const board = page.getByRole("region", { name: "Trip board" });
    await expect(board.getByRole("heading", { name: "Your trip" })).toBeVisible();
    await expect(board.getByText("Waiting for you")).toBeVisible();
    await expect(board.getByText("What Arya knows")).toBeVisible();
    await expect(board.getByText("Coming up on your board")).toBeVisible();
    // No made-up flights, stays or prices on an empty board.
    await expect(board.getByText(/₹|Flights|Waiting for your dates/)).toHaveCount(0);

    // Ideas to start with are one tap away.
    const ideas = page.getByRole("list", { name: "Ideas to start with" });
    await expect(ideas.getByRole("button")).toHaveCount(4);

    // Saved places and Get help are in the tray under the box; Your trips is a menu.
    await page.getByRole("button", { name: /Saved places/ }).click();
    await expect(page.getByText(/No saved places yet|Tap places to add them/)).toBeVisible();
    await page.getByRole("button", { name: "Get help" }).click();
    await expect(page.getByText("Open or start a trip first so we can attach this request to it.")).toBeVisible();
    await page.getByRole("button", { name: "Your trips" }).click();
    await expect(page.getByRole("menuitem", { name: "New trip" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "Your trips" })).toHaveCount(0);
    if (SHOT) await page.screenshot({ path: `${SHOT}/arya.png`, fullPage: true });
  });
});
