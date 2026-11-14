// Prompt 38F, commit E: the clip post itself - the feed card, the post page and
// the five-chip phone bar.
//
// Every adult assertion here is a DOM assertion, not a screenshot: the masked
// row must hold no <img>, no <a>, no anime name and no clip path, and the page
// HTML must not contain the adult title or the clip's URL anywhere. That is the
// owner's rule stated as something that can fail.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const SHOTS = path.resolve(__dirname, "screenshots");
mkdirSync(SHOTS, { recursive: true });

const CLIP_ID = "10000000-0000-4000-8000-000000000031";
const ADULT_ID = "10000000-0000-4000-8000-000000000032";
const REMOVED_ID = "10000000-0000-4000-8000-000000000033";

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

/** The feed finishes in two paints: the rows, then the clip cards. */
async function settleFeed(page: Page) {
  await page.locator("[data-clip-post]").first().waitFor();
  await expect(page.locator("[data-clip-post]")).toHaveCount(3);
}

test.describe("clip posts", () => {
  test("the feed draws a live clip, a masked adult clip and a removed one", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/community");
    await settleFeed(page);

    const live = page.locator("[data-clip-post='live']").first();
    await expect(live).toHaveAttribute("href", "/clip/abc2345");
    await expect(live.locator("img")).toHaveCount(1);
    await expect(live).toContainText("The best fight");
    await expect(live).toContainText("Frieren: Beyond Journey's End · E12 · 1:02-1:17 · 15s");
    await expect(live).toContainText("Watch the clip");

    const hidden = page.locator("[data-clip-post='hidden_adult']").first();
    await expect(hidden).toHaveCount(1);
    await expect(hidden.locator("img")).toHaveCount(0);
    await expect(hidden.locator("a")).toHaveCount(0);
    await expect(hidden).toContainText("Adult content 18+");
    await expect(hidden).toContainText("Turn on adult content in settings to view");

    const removed = page.locator("[data-clip-post='removed']").first();
    await expect(removed).toContainText("This clip was removed");
    await expect(removed).toContainText("The post is still here, but the clip is gone.");

    // The masked clip leaks nothing into the page at all - not the title, not a
    // link, not the clip's path.
    const html = await page.content();
    expect(html).not.toContain("Adult Title");
    expect(html).not.toContain("/clip/adult77");

    await shot(page, "phase3-feed-clip-cards");
  });

  test("the Comments chip draws an episode comment", async ({ page }) => {
    // The regression: the client loader kept posts and announcements and threw
    // comments away, so this tab was empty even though the RPC answered.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/community");
    await settleFeed(page);
    await page.getByRole("navigation").getByRole("button", { name: "Comments", exact: true }).click();
    await expect(
      page.getByText("This episode comment belongs in the community feed."),
    ).toBeVisible({ timeout: 15000 });
    // It is a card like any other: the anime, the episode and a way into the
    // thread, plus the reply count the RPC sent.
    await expect(page.getByText("Frieren: Beyond Journey's End").first()).toBeVisible();
    await expect(page.getByText("Episode 12").first()).toBeVisible();
    await expect(page.getByText("2 replies").first()).toBeVisible();
    await shot(page, "phase3-comments-tab");
  });

  test("the Clips chip narrows the feed to clips", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/community");
    await settleFeed(page);
    // Desktop draws the filters as buttons in a nav, not as tabs.
    await page.getByRole("navigation").getByRole("button", { name: "Clips", exact: true }).click();
    await expect(page.locator("[data-clip-post]")).toHaveCount(3);
    // A clip post is still a post, so the text cards it replaced must be gone.
    await expect(page.locator("[data-feed-key^='announcement:']")).toHaveCount(0);
    await expect(page.getByText("Started Frieren again with my sister")).toHaveCount(0);
  });

  test("the post page shows the clip it was posted with", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/community/post/${CLIP_ID}`);
    const live = page.locator("[data-clip-post='live']").first();
    await expect(live).toHaveAttribute("href", "/clip/abc2345");
    await expect(live.locator("img")).toHaveCount(1);
    await expect(page.getByText("This fight is the whole reason the arc works.")).toBeVisible();
    await shot(page, "phase3-post-page-clip");
  });

  test("the post page masks an adult clip for a guest", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/community/post/${ADULT_ID}`);
    const hidden = page.locator("[data-clip-post='hidden_adult']").first();
    await expect(hidden).toHaveCount(1);
    await expect(hidden.locator("img")).toHaveCount(0);
    await expect(hidden.locator("a")).toHaveCount(0);
    await expect(hidden).toContainText("Adult content 18+");

    const html = await page.content();
    expect(html).not.toContain("Adult Title");
    expect(html).not.toContain("/clip/");
    await shot(page, "phase3-post-page-adult");
  });

  test("the post page still says so when the clip is gone", async ({ page }) => {
    await page.goto(`/community/post/${REMOVED_ID}`);
    await expect(page.locator("[data-clip-post='removed']")).toContainText("This clip was removed");
    await expect(page.getByText("The clip I posted last week is gone, sorry.")).toBeVisible();
  });

  test("five chips fit one row on a 360px phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/community");
    await settleFeed(page);

    // The phone bar is the chips row; the desktop nav is hidden at this width.
    const chips = page.locator("[role='tablist']").getByRole("tab");
    await expect(chips).toHaveCount(5);
    // Each chip carries the full label and the phone label; CSS shows one. Only
    // the visible text counts, which is why this reads innerText.
    const labels = await chips.evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.trim()));
    expect(labels).toEqual(["All", "Posts", "Comments", "News", "Clips"]);

    // One row: every chip shares the same top edge.
    const tops = await chips.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);

    // And nothing sticks out sideways.
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner);

    await shot(page, "phase3-mobile-five-chips");
  });
});
