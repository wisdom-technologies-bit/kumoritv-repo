// Part B in a real browser: the announcement teaser in the feed, the rail and
// the index, at 360, 412, 768 and 1280.
//
// The body fixtures come from the stub (`/__fixture?announcementFixture=...`):
// the Phase 4 sample, a 5,000-character body, a <script> payload, an unclosed
// `**`, a body that is one giant URL, and an empty body.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SHOTS = path.resolve(__dirname, "screenshots");
mkdirSync(SHOTS, { recursive: true });

const STUB = `http://127.0.0.1:${Number(process.env.STUB_PORT || 54329)}`;
const WIDTHS = [360, 412, 768, 1280] as const;

async function fixture(page: Page, name: string | null) {
  const query = name ? `?announcementFixture=${name}` : "?announcementFixture=";
  const response = await page.request.get(`${STUB}/__fixture${query}`);
  expect(response.ok()).toBeTruthy();
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
  writeFileSync(path.join(SHOTS, `${name}.json`), JSON.stringify({ name, url: page.url(), viewport: page.viewportSize() }, null, 2));
}

/** Geometry from the element itself: boundingBox() can race a re-render. */
async function measure(locator: import("@playwright/test").Locator) {
  // The feed polls, so a card can be replaced while we measure it: retry on a
  // detached node instead of failing the assertion for a timing reason.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await locator.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { height: rect.height, width: rect.width, scroll: node.scrollHeight, client: node.clientHeight };
      });
    } catch {
      await locator.page().waitForTimeout(250);
    }
  }
  throw new Error("the card kept re-rendering before it could be measured");
}

const card = (page: Page) => page.locator('article[data-feed-key^="announcement:"]').first();

async function noHorizontalOverflow(page: Page, width: number) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `no horizontal overflow at ${width}`).toBeLessThanOrEqual(width + 1);
}

test.describe.configure({ mode: "serial" });

for (const width of WIDTHS) {
  test(`the sample announcement renders as a clamped preview at ${width}`, async ({ page }) => {
    await fixture(page, "sample");
    await page.setViewportSize({ width, height: width < 768 ? 900 : 1000 });
    await page.goto("/community");
    const article = card(page);
    await expect(article).toBeVisible();

    const text = (await article.innerText()).replace(/\s+/g, " ");
    expect(text).not.toContain("**");
    expect(text).not.toContain("](");

    const preview = article.locator('[data-markdown-variant="preview"]');
    await expect(preview).toBeVisible();
    await expect(article.getByRole("link", { name: "Read more" })).toBeVisible();
    // A heading in the body never becomes a heading in the card.
    expect(await preview.locator("h1, h2, h3, h4, h5, h6").count()).toBe(0);

    const box = await measure(preview);
    const lineHeight = 15 * 1.55;
    const maxLines = width < 768 ? 4 : 5;
    expect(box.height).toBeLessThanOrEqual(lineHeight * maxLines + 4);
    expect(box.height).toBeLessThanOrEqual(320);

    await noHorizontalOverflow(page, width);
    await shot(page, `announcement-preview-${width}`);
  });
}

test("a 5,000-character body is clamped and offers Read more", async ({ page }) => {
  await fixture(page, "long");
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/community");
  const article = card(page);
  const preview = article.locator('[data-markdown-variant="preview"]');
  await expect(preview).toBeVisible();
  await expect(article.getByRole("link", { name: "Read more" })).toBeVisible();
  const box = await measure(preview);
  // 4 lines at 15px/1.55 on a phone, and nowhere near the 5,000 characters.
  expect(box.height).toBeLessThanOrEqual(4 * 15 * 1.55 + 4);
  const shown = (await preview.innerText()).replace(/\s+/g, " ").trim();
  expect(shown.length).toBeGreaterThan(80);
  expect(shown.length).toBeLessThan(360);
  await noHorizontalOverflow(page, 360);
  await shot(page, "announcement-preview-long-360");
});

test("<script> and javascript: payloads are inert in the card", async ({ page }) => {
  await fixture(page, "script");
  let dialog = false;
  page.on("dialog", async (d) => {
    dialog = true;
    await d.dismiss();
  });
  await page.setViewportSize({ width: 412, height: 900 });
  await page.goto("/community");
  const article = card(page);
  await expect(article).toBeVisible();
  expect(dialog).toBe(false);
  expect(await article.locator("script").count()).toBe(0);
  const hrefs = await article.locator("a").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
  expect(hrefs.some((href) => href.toLowerCase().startsWith("javascript:"))).toBe(false);
  await expect(article.getByText("Plain words", { exact: false })).toBeVisible();
  await shot(page, "announcement-preview-script-412");
});

test("an unterminated ** never shows raw stars", async ({ page }) => {
  await fixture(page, "unterminated");
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/community");
  const article = card(page);
  await expect(article).toBeVisible();
  const text = await article.innerText();
  expect(text).not.toContain("**");
  await shot(page, "announcement-preview-unterminated-768");
});

test("a body that is only a giant URL never overflows and still offers Read more", async ({ page }) => {
  await fixture(page, "urlonly");
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/community");
  const article = card(page);
  await expect(article).toBeVisible();
  await noHorizontalOverflow(page, 360);
  await expect(article.getByRole("link", { name: "Read more" })).toBeVisible();
  await shot(page, "announcement-preview-urlonly-360");
});

test("an empty body renders no teaser and no Read more", async ({ page }) => {
  await fixture(page, "empty");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/community");
  const article = card(page);
  await expect(article).toBeVisible();
  expect(await article.locator('[data-markdown-variant="preview"]').count()).toBe(0);
  expect(await article.getByRole("link", { name: "Read more" }).count()).toBe(0);
  await shot(page, "announcement-preview-empty-1280");
});

test("the right rail shows title, date and at most two plain lines", async ({ page }) => {
  await fixture(page, "long");
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/community");
  const rail = page.locator('section[aria-labelledby="rail-announcements"]');
  await expect(rail).toBeVisible();
  const item = rail.locator("li").first();
  const text = await item.innerText();
  expect(text).not.toContain("**");
  expect(text).not.toContain("#");
  const lines = text.split("\n").filter(Boolean);
  expect(lines.length).toBeGreaterThanOrEqual(2);
  const body = item.locator("span").last();
  const box = await measure(body);
  expect(box.height).toBeLessThanOrEqual(12.5 * 1.45 * 2 + 4);
  await shot(page, "announcement-rail-1280");
});

test("the announcements index shows the preview, never the raw source", async ({ page }) => {
  await fixture(page, "sample");
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/community/announcements");
  const first = page.locator("article").first();
  await expect(first).toBeVisible();
  const text = await first.innerText();
  expect(text).not.toContain("**");
  expect(text).not.toContain("](");
  await expect(first.getByRole("link", { name: "Read more" })).toBeVisible();
  await shot(page, "announcement-index-1280");

  await page.setViewportSize({ width: 360, height: 900 });
  await page.reload();
  await noHorizontalOverflow(page, 360);
  await shot(page, "announcement-index-360");
});

test("the full announcement page still renders real blocks", async ({ page }) => {
  await fixture(page, "sample");
  await page.setViewportSize({ width: 768, height: 1000 });
  await page.goto("/community/announcements");
  await page.locator("article h2 a").first().click();
  await page.waitForURL(/\/community\/announcements\/[0-9a-f-]{36}/);
  const body = page.locator('[data-markdown-body="true"]').first();
  await expect(body.locator("h2")).toHaveText("Service Update: KumoriTV Is Back Online!");
  await shot(page, "announcement-detail-768");
});
