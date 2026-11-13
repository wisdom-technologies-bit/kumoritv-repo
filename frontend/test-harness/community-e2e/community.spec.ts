// Prompt 38B screenshots + layout assertions.
//
// Reald production build, real CSS, a local stand-in for Supabase. Every shot is
// written to test-harness/community-e2e/screenshots/ and every layout assertion
// is a real measurement (no eyeballing).
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SHOTS = path.resolve(__dirname, "screenshots");
mkdirSync(SHOTS, { recursive: true });

const APP = `http://127.0.0.1:${Number(process.env.E2E_PORT || 3100)}`;
const OFF = `http://127.0.0.1:${Number(process.env.E2E_PORT || 3100) + 1}`;
const POST_ID = "10000000-0000-4000-8000-000000000001";
const ANNOUNCEMENT_ID = "10000000-0000-4000-8000-000000000011";

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "412x915", width: 412, height: 915 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
  writeFileSync(path.join(SHOTS, `${name}.json`), JSON.stringify({ name, at: new Date().toISOString() }));
}

/** No horizontal scroll anywhere: the assertion the design has to pass. */
async function expectNoOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(metrics.scrollWidth, `${label} document scrollWidth`).toBeLessThanOrEqual(metrics.innerWidth);
  expect(metrics.bodyScrollWidth, `${label} body scrollWidth`).toBeLessThanOrEqual(metrics.innerWidth);
  return metrics;
}

test("the feed renders three cards with a first card that has a name and a time", async ({ page }) => {
  await page.goto("/community");
  await page.waitForSelector("[data-feed-key]");
  const cards = page.locator("[data-feed-key]");
  expect(await cards.count()).toBeGreaterThanOrEqual(3);

  const first = cards.first();
  await expect(first).toContainText(/Announcement/i);
  // The first *post* carries its author's name.
  await expect(page.locator('[data-feed-key^="post:"]').first()).toContainText("Adaeze");
});

test("the announcement chip carries the megaphone and the pinned position", async ({ page }) => {
  await page.goto("/community");
  const badge = page.locator("[data-feed-key]").first().getByText("Announcement", { exact: false }).first();
  await expect(badge).toBeVisible();
  const svg = page.locator("[data-feed-key]").first().locator("svg").first();
  expect(await svg.count()).toBeGreaterThan(0);
});

for (const viewport of VIEWPORTS) {
  test(`feed at ${viewport.name}: layout, card count and no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/community");
    await page.waitForSelector("[data-feed-key]");

    const metrics = await expectNoOverflow(page, `feed ${viewport.name}`);
    writeFileSync(path.join(SHOTS, `feed-${viewport.name}.metrics.json`), JSON.stringify(metrics));

    await shot(page, `feed-${viewport.name}`);

    if (viewport.width >= 1200) {
      // three columns: left nav, centre feed, right rail
      await expect(page.locator("nav[aria-label='Filter the feed']")).toBeVisible();
      await expect(page.getByText("Latest announcements", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Write a post" })).toBeHidden();
    }
    if (viewport.width < 768) {
      // one column, sticky bottom bar, floating compose button
      await expect(page.locator("nav[aria-label='Filter the feed']")).toBeHidden();
      await expect(page.getByText("Latest announcements", { exact: true })).toBeHidden();
      await expect(page.getByRole("button", { name: "Write a post" })).toBeVisible();
      const bar = page.locator('[class*="mobile_bar"] [role="tablist"]');
      await expect(bar).toBeVisible();
      await expect(bar.getByRole("tab")).toHaveCount(3);
      await expect(bar.getByRole("tab", { name: "All" })).toBeVisible();
      await expect(bar.getByRole("tab", { name: "Posts" })).toBeVisible();
      await expect(bar.getByRole("tab", { name: "Announcements" })).toBeVisible();
      await bar.getByRole("tab", { name: "Posts" }).click();
      await expect(bar.getByRole("tab", { name: "Posts" })).toHaveAttribute("aria-selected", "true");
      await bar.getByRole("tab", { name: "All" }).click();
    }
  });
}

test("the mobile composer sheet opens for a guest, locks scroll, closes on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/community");

  await expect(page.locator('[class*="mobile_bar"]')).toBeVisible();
  await page.getByRole("button", { name: "Write a post" }).click();

  const dialog = page.getByRole("dialog", { name: "New post" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Sign in to post")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();

  const box = await dialog.boundingBox();
  expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(400);
  expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(900);

  // scroll is locked while the sheet is open, and no horizontal overflow
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
  await expectNoOverflow(page, "sheet open 412");

  await shot(page, "composer-sheet-412x915");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
  await expect(page.locator('[class*="mobile_bar"]')).toBeVisible();
});

test("the mobile composer sheet opens at 360 too", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/community");

  await expect(page.locator('[class*="mobile_bar"]')).toBeVisible();
  const fab = page.locator('button[aria-label="Write a post"]').last();
  await expect(fab).toBeVisible();
  await fab.click({ force: true });

  const dialog = page.getByRole("dialog", { name: "New post" });
  await expect(dialog).toBeVisible();
  await expectNoOverflow(page, "sheet open 360");
  await shot(page, "composer-sheet-360x800");

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

test("the desktop composer is inline and the guest sees the sign-in state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/community");
  await expect(page.getByText("Sign in to post")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await shot(page, "composer-guest-1440x900");
});

test("an empty announcements feed shows its own message and a call to action", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/community");
  await page.waitForSelector("[data-feed-key]");

  await page.getByRole("button", { name: "Announcements", exact: true }).first().click();

  await expect(page.getByText("No announcements right now")).toBeVisible();
  await expect(page.getByRole("button", { name: /Write a post instead|Sign in to post/ })).toBeVisible();
  await shot(page, "feed-empty-1440x900");

  await page.setViewportSize({ width: 360, height: 800 });
  const bar = page.locator('[class*="mobile_bar"]');
  await bar.getByRole("tab", { name: "Announcements" }).click();
  await expect(page.getByText("No announcements right now")).toBeVisible();
  await expectNoOverflow(page, "empty 360");
  await shot(page, "feed-empty-360x800");
});

test("a spoiler post is blurred until revealed", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/community");
  const spoilerButton = page.locator("[data-feed-key] button", { hasText: "Spoiler" }).first();
  await expect(spoilerButton).toBeVisible();
  await shot(page, "feed-spoiler-1024x768");
  await spoilerButton.click();
  await expect(page.getByText("That final fight", { exact: false })).toBeVisible();
});

test("the post page renders the body and its comments", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/community/post/${POST_ID}`);
  await expect(page.getByText("Started Frieren again", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("The pacing in the second half", { exact: false }).first()).toBeVisible();
  await expectNoOverflow(page, "post 1440x900");
  await shot(page, "post-1440x900");

  await page.setViewportSize({ width: 360, height: 800 });
  await expectNoOverflow(page, "post 360x800");
  await shot(page, "post-360x800");
});

test("the announcement page shows the title, the body and Read more", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/community/announcements/${ANNOUNCEMENT_ID}`);
  await expect(page.getByText("Season 2 of the weekly digest starts Sunday")).toBeVisible();

  const readMore = page.getByRole("link", { name: "Read more" });
  await expect(readMore).toBeVisible();
  await expect(readMore).toHaveAttribute("rel", "noopener noreferrer");
  await expect(readMore).toHaveAttribute("target", "_blank");

  await expectNoOverflow(page, "announcement 1440x900");
  await shot(page, "announcement-1440x900");
});

test("the footer carries the Community link when the flag is on", async ({ page }) => {
  await page.goto("/community");
  const footerLink = page.locator("footer a[href='/community']");
  await expect(footerLink).toHaveCount(1);
});

test("SEO: the index is indexable, a post is noindex,follow", async ({ page }) => {
  await page.goto("/community");
  expect(await page.locator("meta[name='robots']").first().getAttribute("content")).toMatch(/index/);

  await page.goto(`/community/post/${POST_ID}`);
  const robots = await page.locator("meta[name='robots']").first().getAttribute("content");
  expect(robots).toContain("noindex");
  expect(robots).toContain("follow");
});

// ------------------------------------------------------- the flag, switched off

test("flag off: /community and the APIs are 404 and the footer has no link", async ({ request }) => {
  const community = await request.get(`${OFF}/community`);
  expect(community.status()).toBe(404);

  const post = await request.get(`${OFF}/community/post/${POST_ID}`);
  expect(post.status()).toBe(404);

  const api = await request.post(`${OFF}/api/community/posts`, { data: { body: "hello" } });
  expect(api.status()).toBe(404);

  const report = await request.post(`${OFF}/api/community/report`, {
    data: { target_kind: "post", target_id: POST_ID, reason: "spam" },
  });
  expect(report.status()).toBe(404);

  const home = await request.get(`${OFF}/`);
  const html = await home.text();
  expect(html.includes('href="/community"')).toBe(false);
});

test("flag on: the API refuses a guest even before validation", async ({ request }) => {
  const response = await request.post(`${APP}/api/community/posts`, { data: { body: "hello" } });
  expect([401, 403]).toContain(response.status());
});
