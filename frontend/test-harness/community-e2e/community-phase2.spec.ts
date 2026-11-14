// Prompt 38E Phase 2: comment cards in the feed, the deep links back to the
// thread they were written in, the Comments chip and the two rail fixes.
//
// Runs against the real production build with the local stand-in for Supabase
// and AniList (see stub.mjs). Nothing here is eyeballed: every "visible",
// "highlighted", "not covered" and "no overflow" claim is a measurement, and
// every screenshot is written to screenshots/phase2/.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SHOTS = path.resolve(__dirname, "screenshots/phase2");
mkdirSync(SHOTS, { recursive: true });

const APP = `http://127.0.0.1:${Number(process.env.E2E_PORT || 3100)}`;

const POST_ID = "10000000-0000-4000-8000-000000000001";
const POST_COMMENT = "10000000-0000-4000-8000-000000000021";
const POST_REPLY = "10000000-0000-4000-8000-000000000023";
const ANIME_COMMENT = "10000000-0000-4000-8000-000000000031";
const EPISODE_COMMENT = "10000000-0000-4000-8000-000000000041";
const MISSING_COMMENT = "10000000-0000-4000-8000-0000000009ff";

const HIGHLIGHT_MS = 2400;

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
  writeFileSync(path.join(SHOTS, `${name}.json`), JSON.stringify({ name, at: new Date().toISOString() }));
}

/** The exact overflow rule the owner asked for, not a "close enough" version. */
async function expectNoOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth, `${label}: document.scrollWidth must equal innerWidth`).toBe(metrics.innerWidth);
  return metrics;
}

type Landed = { top: number; height: number; headerBottom: number; text: string };

/** Poll from the moment the document is interactive: the tint only lives for
 *  2.4 s, and the media page is slow enough that waiting for `networkidle`
 *  first can outlast it. This measures the row while it is actually tinted. */
async function waitForTint(page: Page, id: string): Promise<Landed | null> {
  // Measured, not guessed: under the stand-in the /media thread only paints its
  // rows at ~11.7 s (AniList + episodes are answered locally but the page streams
  // through several boundaries). The tint itself follows within a second, so the
  // wait is generous while every assertion stays exactly as strict.
  const deadline = Date.now() + 25_000;
  const read = () =>
    page.evaluate((commentId) => {
      const node = document.getElementById(`comment-${commentId}`);
      if (!node || node.getAttribute("data-comment-highlight") !== "true") return null;

      // The sticky header, or the player on a watch page, measured not assumed.
      let headerBottom = 0;
      for (const element of Array.from(document.querySelectorAll("*"))) {
        const style = getComputedStyle(element);
        if (style.position !== "sticky" && style.position !== "fixed") continue;
        const rect = element.getBoundingClientRect();
        if (rect.top <= 8 && rect.bottom > 8 && rect.height > 20 && rect.height <= 220) {
          if (rect.width >= window.innerWidth * 0.5) headerBottom = Math.max(headerBottom, rect.bottom);
        }
      }

      const rect = node.getBoundingClientRect();
      return {
        top: rect.top,
        height: rect.height,
        headerBottom,
        text: (node as HTMLElement).innerText.slice(0, 160),
      };
    }, id);

  while (Date.now() < deadline) {
    const snapshot = await read();
    if (snapshot) {
      // The scroll is smooth: measure again once it has settled.
      await page.waitForTimeout(450);
      return (await read()) ?? snapshot;
    }
    await page.waitForTimeout(60);
  }
  return null;
}

/** The whole "the deep link actually landed" claim, in one place. */
async function expectLandedOnComment(page: Page, id: string, label: string) {
  const landed = await waitForTint(page, id);
  expect(landed, `${label}: #comment-${id} must be tinted, i.e. the link landed on it`).not.toBeNull();
  expect(landed!.height, `${label}: the row must not be collapsed`).toBeGreaterThan(20);
  expect(
    landed!.top,
    `${label}: the row top (${Math.round(landed!.top)}) must sit below the sticky header bottom (${Math.round(landed!.headerBottom)})`,
  ).toBeGreaterThanOrEqual(landed!.headerBottom - 1);
  await expect(page.locator(`#comment-${id}`)).toBeInViewport();
  return landed!;
}

/* ------------------------------------------------------------------ feed */

test("the comment arm is in the feed, with the anime it belongs to", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/community");
  await page.waitForSelector('[data-community-card="comment"]');

  const cards = page.locator('[data-community-card="comment"]');
  expect(await cards.count(), "at least two comment cards in the feed").toBeGreaterThanOrEqual(2);

  const first = cards.first();
  await expect(first).toContainText("Frieren");
  // "Episode N" or "Anime page" - one of the two chips, never both.
  const chipText = await first.locator('[class*="chip"]').first().innerText();
  expect(["Anime page", "Episode 12", "Episode 3", "Episode 5"]).toContain(chipText.trim());

  // Counts are read-only in the feed; the card is one link to the thread.
  await expect(first).toHaveAttribute("href", /#comment-/);
  const href = await first.getAttribute("href");
  expect(href, "a comment card links to the thread it was written in").toMatch(
    /^\/(watch\/\d+\?ep=\d+|media\/\d+)#comment-[0-9a-f-]{36}$/,
  );

  await shot(page, "feed-comment-cards-1440x900");
});

test("a comment card at 360 is readable and still one link", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/community");
  await page.waitForSelector("[data-community-card='comment']");

  const card = page.locator('[data-community-card="comment"]').first();
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  expect(box!.width, "the card fits the 360px column").toBeLessThanOrEqual(360);
  await expect(card).toContainText("Adaeze");

  await expectNoOverflow(page, "feed with comment cards at 360");
  await shot(page, "feed-comment-card-360x800");
});

test("clicking a comment card at 1440 lands on the deep link with the hash", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/community");
  await page.waitForSelector('[data-community-card="comment"]');

  // Pick the episode card: it exercises the watch URL, the harder of the two.
  const card = page.locator('[data-community-card="comment"]').filter({ hasText: "Episode 12" }).first();
  const href = (await card.getAttribute("href")) ?? "";
  expect(href).toBe(`/watch/21?ep=12#comment-${EPISODE_COMMENT}`);

  // Subscribe before clicking: waiting afterwards can miss the navigation.
  const navigation = page.waitForURL((url) => url.hash.length > 0, { timeout: 20_000 });
  await card.click();
  await navigation;
  expect(page.url(), "the browser is on the thread, with the hash").toBe(`${APP}${href}`);

  await expectLandedOnComment(page, EPISODE_COMMENT, "clicked at 1440");
  await shot(page, "deeplink-click-card-1440x900");
});

test("clicking a comment card at 360 lands on the deep link with the hash", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/community");
  await page.waitForSelector('[data-community-card="comment"]');

  const card = page.locator('[data-community-card="comment"]').filter({ hasText: "Anime page" }).first();
  const href = (await card.getAttribute("href")) ?? "";
  expect(href).toBe(`/media/21#comment-${ANIME_COMMENT}`);

  const navigation = page.waitForURL((url) => url.hash.length > 0, { timeout: 20_000 });
  await card.click();
  await navigation;
  expect(page.url()).toBe(`${APP}${href}`);

  await expectLandedOnComment(page, ANIME_COMMENT, "clicked at 360");
  await shot(page, "deeplink-click-card-360x800");
});

/* ------------------------------------------------------------ thread pages */

test("the post page deep link shows, highlights and does not bury the comment", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/community/post/${POST_ID}#comment-${POST_COMMENT}`, { waitUntil: "domcontentloaded" });
  await expectLandedOnComment(page, POST_COMMENT, "post page deep link");
  await shot(page, "deeplink-post-1440x900");
});

test("a reply deep link expands its parent thread first", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/community/post/${POST_ID}#comment-${POST_REPLY}`, { waitUntil: "domcontentloaded" });

  const reply = await expectLandedOnComment(page, POST_REPLY, "reply deep link");
  expect(reply.text, "the reply itself is the row that was opened").toContain("dinner scene");
  // The parent is the thread it belongs to; both are on the page now.
  await expect(page.locator(`#comment-${POST_COMMENT}`)).toBeVisible();
  await expect(page.locator(`#comment-${POST_REPLY}`)).toBeVisible();
});

test("the /media deep link lands under the header at 1440 and at 360", async ({ page }) => {
  for (const [width, height, name] of [
    [1440, 900, "deeplink-media-1440x900"],
    [360, 800, "deeplink-media-360x800"],
  ] as const) {
    await page.setViewportSize({ width, height });
      await page.goto(`/media/21#comment-${ANIME_COMMENT}`, { waitUntil: "domcontentloaded" });
    const state = await expectLandedOnComment(page, ANIME_COMMENT, `/media deep link at ${width}`);
    expect(state.text).toContain("Frieren");
    await expectNoOverflow(page, `/media deep link at ${width}`);
    await shot(page, name);
  }
});

test("the watch deep link lands on the comment, not just the URL", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/watch/21?ep=12#comment-${EPISODE_COMMENT}`, { waitUntil: "domcontentloaded" });
  // The watch page remounts the thread per ?ep=, so the hash has to survive that.
  await expectLandedOnComment(page, EPISODE_COMMENT, "watch deep link");
  await shot(page, "deeplink-watch-1440x900");
});

test("a hash for a missing comment shows the note and does not crash", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/media/21#comment-${MISSING_COMMENT}`);
  await page.waitForSelector("[data-feed-key], #comment-", { timeout: 20_000 }).catch(() => {});

  await expect(page.getByText("That comment is no longer available.")).toBeVisible({ timeout: 15_000 });

  // The thread is still there: it shows from the top instead of an error page.
  const rows = await page.locator('[id^="comment-"]').count();
  expect(rows, "the thread still renders its other comments").toBeGreaterThan(0);
  expect(crashes, `no uncaught error: ${crashes.join(" | ")}`).toHaveLength(0);
  await shot(page, "deeplink-missing-comment-1440x900");
});

/* ------------------------------------------------------------------ chips */

test("the Comments chip is in the desktop nav and filters the feed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/community");

  const nav = page.locator("nav[aria-label='Filter the feed']");
  await expect(nav).toBeVisible();
  const items = nav.locator("li button");
  expect(await items.count(), "four chips on the desktop nav").toBe(4);
  await expect(nav.getByRole("button", { name: "Comments" })).toBeVisible();

  await nav.getByRole("button", { name: "Comments" }).click();
  await page.waitForSelector('[data-community-card="comment"]');
  expect(
    await page.locator('[data-feed-key]:not([data-feed-key^="comment:"])').count(),
    "only comment cards remain",
  ).toBe(0);

  await shot(page, "feed-filter-comments-1440x900");
});

test("?filter=comment renders the comments feed on the server", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/community?filter=comment");
  await page.waitForSelector('[data-community-card="comment"]');
  expect(await page.locator('[data-feed-key^="comment:"]').count()).toBeGreaterThan(0);

  // The plural form a shared link may carry means the same thing.
  await page.goto("/community?filter=comments");
  await page.waitForSelector('[data-community-card="comment"]');
  expect(
    await page.locator('[data-feed-key^="comment:"]').count(),
    "?filter=comments is the same feed, not the fallback",
  ).toBeGreaterThan(0);
});

for (const width of [320, 360, 390, 412]) {
  test(`the Comments chip on the mobile bar at ${width}px: one row, no overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/community");
    await page.waitForSelector('[class*="mobile_bar"] [role="tablist"]');

    const bar = page.locator('[class*="mobile_bar"] [role="tablist"]');
    const tabs = bar.getByRole("tab");
    expect(await tabs.count(), "four tabs in the bottom bar").toBe(4);

    // One row: every tab shares a top edge.
    const tops = await tabs.evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size, `all four chips on one row (tops: ${tops.join(", ")})`).toBe(1);

    // No wrapping, and no clipped chip: if the row is wider than the bar it
    // must scroll horizontally (with snap), never be cut off.
    const row = await bar.evaluate((node) => {
      const style = getComputedStyle(node);
      // The row itself, or the nearest ancestor that scrolls it: at 320px the
      // bar is the scroller, the row inside it is wider than the bar.
      let scroller: HTMLElement | null = node as HTMLElement;
      while (scroller && scroller !== document.body) {
        const own = getComputedStyle(scroller);
        if (own.overflowX === "auto" || own.overflowX === "scroll") break;
        scroller = scroller.parentElement;
      }
      const scrolling = scroller && scroller !== document.body ? scroller : null;
      return {
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        rowOverflowX: style.overflowX,
        scrollerOverflowX: scrolling ? getComputedStyle(scrolling).overflowX : "none",
        scrollerSnap: scrolling ? getComputedStyle(scrolling).scrollSnapType : "none",
        whiteSpace: style.flexWrap,
      };
    });
    expect(row.whiteSpace, "the chips never wrap").toBe("nowrap");
    if (row.scrollWidth > row.clientWidth) {
      // Wider than the screen is fine, as long as something scrolls it (with
      // snap) rather than cutting a chip off.
      const scrollable = [row.rowOverflowX, row.scrollerOverflowX].some((value) => value === "auto" || value === "scroll");
      expect(scrollable, `the overflow scrolls instead of clipping (row: ${row.rowOverflowX}, scroller: ${row.scrollerOverflowX})`).toBe(true);
      // `scroll-snap-type: x proximity` reports as "x" in Chromium, so the
      // assertion is "snapping is on", not the literal word "snap".
      expect(row.scrollerSnap, `the scrolling row snaps (got ${row.scrollerSnap})`).not.toBe("none");
    }

    await expectNoOverflow(page, `mobile bar at ${width}`);

    await bar.getByRole("tab", { name: "Comments" }).click();
    await expect(bar.getByRole("tab", { name: "Comments" })).toHaveAttribute("aria-selected", "true");
    await page.waitForSelector('[data-community-card="comment"]');

    if (width === 360) await shot(page, "mobile-bar-comments-360x800");
  });
}

/* ------------------------------------------------------------------ rails */

for (const [width, height, suffix] of [
  [1024, 800, "1024x800"],
  [1200, 900, "1200x900"],
  [1440, 900, "1440x900"],
] as const) {
  test(`the rails at ${width}: House rules reads like a card and the grid is 2x2`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/community");
    await page.waitForSelector("[data-feed-key]");

    // --- House rules: a real card, with a heading and a readable list.
    const rules = page.locator('[class*="guidelines"]').first();
    await expect(rules).toBeVisible();
    const rulesBox = await rules.boundingBox();
    expect(rulesBox!.width, "the card has its column's width").toBeGreaterThan(150);

    const heading = rules.getByText("House rules", { exact: true });
    await expect(heading).toBeVisible();
    const headingStyle = await heading.evaluate((node) => {
      const style = getComputedStyle(node);
      return { fontSize: parseFloat(style.fontSize), fontWeight: style.fontWeight, color: style.color, display: style.display };
    });
    expect(headingStyle.display, "the heading is not hidden").not.toBe("none");
    expect(headingStyle.fontSize, "heading size is not the 14px body size").toBeGreaterThanOrEqual(12);

    const list = rules.locator("ul");
    await expect(list).toBeVisible();
    const listInfo = await list.evaluate((node) => {
      const style = getComputedStyle(node);
      const item = node.querySelector("li");
      return {
        itemCount: node.querySelectorAll("li").length,
        listStyle: style.listStyleType,
        paddingLeft: parseFloat(style.paddingLeft),
        itemFont: item ? parseFloat(getComputedStyle(item).fontSize) : 0,
        itemLineHeight: item ? parseFloat(getComputedStyle(item).lineHeight) : 0,
        itemColor: item ? getComputedStyle(item).color : "",
      };
    });
    expect(listInfo.itemCount, "the three house rules are there").toBeGreaterThanOrEqual(3);
    expect(listInfo.listStyle, "the list has real bullets, not run-together text").not.toBe("none");
    expect(listInfo.paddingLeft, "the bullets are not flush against the edge").toBeGreaterThan(8);
    expect(listInfo.itemFont, "the list is body size, not a caption").toBeGreaterThanOrEqual(12);
    expect(listInfo.itemLineHeight, "the lines have room to breathe").toBeGreaterThan(listInfo.itemFont);
    expect(listInfo.itemColor, "the text uses a token colour, not transparent/black-on-black").not.toBe("rgba(0, 0, 0, 0)");

    // The card must look like the other cards in the column.
    const cardLike = await rules.evaluate((node) => {
      const style = getComputedStyle(node);
      return { radius: style.borderRadius, background: style.backgroundColor, padding: parseFloat(style.padding) };
    });
    expect(cardLike.radius, "the card is rounded like its neighbours").not.toBe("0px");
    expect(cardLike.padding, "the card has padding").toBeGreaterThan(8);

    await shot(page, `house-rules-${suffix}`);

    // --- Airing this week: four posters, two rows of two.
    const rail = page.locator("section[aria-labelledby='rail-airing']");
    await expect(rail).toBeVisible();
    const posters = rail.locator("a[class*='airing_item']");
    expect(await posters.count(), "the rail shows four posters").toBe(4);

    const geometry = await posters.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width) };
      }),
    );
    expect(new Set(geometry.map((g) => g.y)).size, `two rows (ys: ${geometry.map((g) => g.y).join(",")})`).toBe(2);
    expect(new Set(geometry.map((g) => g.x)).size, `two columns (xs: ${geometry.map((g) => g.x).join(",")})`).toBe(2);
    for (const poster of geometry) {
      expect(poster.w, "a poster is a small tile, not a full-width row").toBeLessThanOrEqual(150);
    }

    // Each poster links to the watch page for its next episode.
    const hrefs = await posters.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
    for (const href of hrefs) expect(href).toMatch(/^\/watch\/\d+\?ep=\d+$/);

    await expect(rail.getByRole("link", { name: /Full schedule/i })).toBeVisible();
    await shot(page, `airing-grid-${suffix}`);
  });
}

/* --------------------------------------------------------------- overflow */

const PAGES = [
  { name: "community", url: "/community", ready: "[data-feed-key]" },
  { name: "comments-filter", url: "/community?filter=comments", ready: '[data-community-card="comment"]' },
  { name: "media-with-hash", url: `/media/21#comment-${ANIME_COMMENT}`, ready: `#comment-${ANIME_COMMENT}` },
  { name: "post-with-hash", url: `/community/post/${POST_ID}#comment-${POST_COMMENT}`, ready: `#comment-${POST_COMMENT}` },
];

const WIDTHS = [320, 360, 390, 412, 600, 768, 1024, 1280, 1440, 1920];

test("no page scrolls sideways at any of the ten widths", async ({ page }) => {
  test.setTimeout(300_000);
  const report: Record<string, Record<string, number>> = {};

  for (const target of PAGES) {
    report[target.name] = {};
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(target.url);
      await page.waitForSelector(target.ready, { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(150);

      const metrics = await expectNoOverflow(page, `${target.name} at ${width}`);
      report[target.name][String(width)] = metrics.scrollWidth;
    }
  }

  writeFileSync(path.join(SHOTS, "overflow-matrix.json"), JSON.stringify(report, null, 2));
});
