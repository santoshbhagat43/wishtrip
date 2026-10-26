import { expect, signUp, test } from "./fixtures";

const YOUTUBE = "https://www.youtube.com/shorts/GE4EgoAVqPA";

test.describe("Paste a reel, signed out", () => {
  test("nothing is read until they have signed in: they go to sign-in first, and come back to the reel", async ({
    page,
  }) => {
    const imports: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/reels/imports")) imports.push(req.url());
    });

    await page.goto(`/reel?url=${encodeURIComponent(YOUTUBE)}`);
    await expect(page).toHaveURL(/\/login|sso\./);
    // After signing in, SSO sends them back to this reel (the link is kept whole).
    const back = new URL(page.url()).searchParams.get("redirect") ?? "";
    expect(new URL(back).pathname).toBe("/reel");
    expect(new URL(back).searchParams.get("url")).toBe(YOUTUBE);
    expect(imports).toEqual([]); // no extraction was started
  });

  test("the paste box on the home page takes a YouTube link too", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Start planning" }).filter({ visible: true }).click();
    const panel = page.getByRole("dialog", { name: "Start planning" }).filter({ visible: true });
    await panel.getByRole("radio", { name: "Paste a reel" }).click();
    const box = panel.getByPlaceholder("instagram.com/reel/… or youtube.com/shorts/…");
    await box.fill(YOUTUBE);
    await box.press("Enter");
    await expect(page).toHaveURL(/\/login|sso\./);
    await expect(page.getByText(/Paste an Instagram reel or YouTube video link/)).toHaveCount(0);
  });
});

test("Sign in from the home page brings them back to the home page, not to Arya", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in", exact: true }).first().click();
  await expect(page).toHaveURL(/sso\./);
  const back = new URL(new URL(page.url()).searchParams.get("redirect") ?? "");
  expect(back.pathname).toBe("/");
});

test("A signed-in traveller sees themselves in the header on the home page and the reel page, not Sign in", async ({ page }) => {
  await signUp(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
  await expect(page.locator("header").first()).toContainText(/e2e-site-\d+/);
  await page.goto("/reel");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
  await expect(page.locator("header").first()).toContainText(/e2e-site-\d+/);
});
