// Prompt 38F, commit C: the composer's clip picker and preview, photographed.
//
// Same production build and same stand-in as community.spec.ts; this file only
// exercises the composer. The adult assertions are real DOM assertions, not
// eyeballing: a masked row must contain no <img>, no anime title and no link.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const SHOTS = path.resolve(__dirname, "screenshots");
mkdirSync(SHOTS, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 360, height: 800 };

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

// The stand-in's uid(101): the account the clip fixtures belong to.
const USER_ID = "10000000-0000-4000-8000-000000000101";

/**
 * A signed-in browser, the way @supabase/ssr stores it: the session lives in
 * `sb-<project-ref>-auth-token`, which the server client reads on every request
 * and presents to /auth/v1/user as a bearer token. The stand-in accepts any
 * bearer token, so this is enough for the API routes and the RSC to see a user.
 */
async function signIn(page: Page) {
  const session = {
    access_token: "standin.access.token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "standin-refresh",
    user: {
      id: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "adaeze@example.test",
      is_anonymous: false,
      user_metadata: { display_name: "Adaeze", username: "adaeze" },
    },
  };
  await page.context().addCookies([
    { name: "standin-user", value: "1", domain: "127.0.0.1", path: "/" },
    {
      name: "sb-127-auth-token",
      value: JSON.stringify(session),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
    },
  ]);
}

/**
 * The first row that is not the masked adult one. The picker lists newest
 * first and the stand-in's adult clip is old, so .first() is usually ordinary -
 * but a row that is masked must never be the one these tests read.
 */
function ordinaryRow(page: Page) {
  // The Frieren clip, whatever order the picker lists the user's clips in.
  return page.locator("[data-clip-picker] li").filter({ hasText: "Frieren" }).first();
}

test.describe("composer picker", () => {
  test.use({ viewport: DESKTOP });

  test("desktop: the popover, the rows and the attachment", async ({ page }) => {
    await signIn(page);
    await page.goto("/community");
    await page.waitForSelector("[data-composer='inline']");

    await page.getByRole("button", { name: "Add clip" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add a clip" });
    await expect(dialog).toBeVisible();
    // The rows came from /api/clips/mine.
    await expect(page.locator("[data-clip-picker] button[data-autofocus='true']")).toBeVisible({ timeout: 15000 });
    await shot(page, "phase3-picker-desktop");

    // The adult row is masked: label and message, and nothing else.
    const adultRow = page.locator("[data-clip-picker] li", { hasText: "Adult content 18+" });
    await expect(adultRow).toHaveCount(1);
    await expect(adultRow.locator("img")).toHaveCount(0);
    await expect(adultRow).not.toContainText("Adult Title");
    await expect(adultRow).toContainText("Turn on adult content in settings to view");

    // An ordinary row shows the anime, the episode, the range and the length.
    const firstRow = ordinaryRow(page);
    await expect(firstRow).toContainText("Frieren");
    await expect(firstRow).toContainText("E12");
    await expect(firstRow).toContainText("1:02-1:17");
    await expect(firstRow).toContainText("15s");

    await firstRow.locator("button").click();
    await expect(page.locator("[data-clip-attachment='true']")).toBeVisible();
    await shot(page, "phase3-composer-preview");

    // Post is enabled with an attachment and no text.
    // exact: the feed's own "Posts" filter button also matches the name.
    await expect(page.getByRole("button", { name: "Post", exact: true })).toBeEnabled();
  });

  test("desktop: paste a clip URL in the paste tab", async ({ page }) => {
    await signIn(page);
    await page.goto("/community");
    await page.waitForSelector("[data-composer='inline']");

    await page.getByRole("button", { name: "Add clip" }).first().click();
    await page.getByRole("tab", { name: "Paste clip URL" }).click();
    await page.getByLabel("Clip link or code").fill("https://kumoritv.top/clip/abc2345");
    await expect(page.getByRole("button", { name: "Attach this clip" })).toBeVisible({ timeout: 15000 });
    await shot(page, "phase3-picker-paste");

    // A lookalike host is refused in words, not silently.
    await page.getByLabel("Clip link or code").fill("https://kumoritv.top.evil.com/clip/abc2345");
    // The picker's own words, inside the dialog: the feed has alerts of its own.
    await expect(page.getByRole("dialog", { name: "Add a clip" }).getByRole("alert")).toContainText(
      "not a KumoriTV clip link",
    );
  });

  test("desktop: a clip URL pasted into the box attaches and leaves the text", async ({ page }) => {
    await signIn(page);
    await page.goto("/community");
    // The inline composer is the one that draws on this page.
    const area = page.getByLabel("Write a post").first();
    await area.click();
    await area.evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text/plain", "this fight https://kumoritv.top/clip/abc2345 is unreal");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(page.locator("[data-clip-attachment='true']")).toBeVisible({ timeout: 15000 });
    await expect(area).toHaveValue("this fight is unreal");
    await expect(page.getByText("Clip attached").first()).toBeVisible();
    await shot(page, "phase3-paste-in-composer");
  });
});

test.describe("mobile picker", () => {
  test.use({ viewport: MOBILE });

  test("360: the sheet opens above the page and lists the clips", async ({ page }) => {
    await signIn(page);
    await page.goto("/community");
    // At 360px the inline composer is hidden and the floating button opens the
    // sheet. Its label is "Write a post", the same words as the text box, so the
    // role has to be named too.
    await page.getByRole("button", { name: "Write a post", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "New post" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Add clip" }).click();

    const picker = page.getByRole("dialog", { name: "Add a clip" });
    await expect(picker).toBeVisible();
    await expect(page.locator("[data-clip-picker] button[data-autofocus='true']")).toBeVisible({ timeout: 15000 });
    await shot(page, "phase3-picker-mobile");

    // One row of tabs, no horizontal overflow, 44px targets.
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
    const tabBox = await page.getByRole("tab", { name: "My recent clips" }).boundingBox();
    expect(tabBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
