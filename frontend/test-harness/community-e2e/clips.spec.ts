// Phase 5 in a real browser: the public clip list at 360, 412, 768 and 1280.
//
// The stub serves 34 live clips (plus one soft-deleted row that must never
// appear): 30 public guest clips so the list needs a second page, two Phase 38F
// clips and two on an adult title. The adult ones are asserted to be
// placeholders with no link and no thumbnail, because that is the one thing a
// shared, publicly cached list must not leak.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SHOTS = path.resolve(__dirname, "screenshots");
mkdirSync(SHOTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 3100);
const OFF = `http://127.0.0.1:${PORT + 1}`;
const WIDTHS = [360, 412, 768, 1280] as const;

/** The stub's public fixture code for a 0-based index (alphabet-safe, 7 chars). */
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
function publicCode(index: number) {
  let value = index + 1;
  let suffix = "";
  while (value > 0) {
    suffix = ALPHABET[value % ALPHABET.length] + suffix;
    value = Math.floor(value / ALPHABET.length);
  }
  return `pub${suffix.padStart(4, ALPHABET[0])}`;
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
  writeFileSync(
    path.join(SHOTS, `${name}.json`),
    JSON.stringify({ name, url: page.url(), viewport: page.viewportSize() }, null, 2),
  );
}

/** Scrolls through the whole list, then reports if anything is wider than the viewport. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const offenders: Array<{ tag: string; width: number }> = [];
    for (const node of Array.from(document.querySelectorAll("body *"))) {
      const box = node.getBoundingClientRect();
      if (box.width > 0 && box.right > root.clientWidth + 1) {
        offenders.push({ tag: node.tagName.toLowerCase(), width: Math.round(box.width) });
      }
    }
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      offenders: offenders.slice(0, 5),
    };
  });
}

/** The rendered column count of the grid, from the computed template. */
async function columns(page: Page) {
  const grid = page.getByTestId("clips-grid");
  await expect(grid).toBeVisible();
  return grid.evaluate((node) => {
    const template = getComputedStyle(node).gridTemplateColumns;
    return template.split(" ").filter(Boolean).length;
  });
}

test.describe("the public clip list", () => {
  for (const width of WIDTHS) {
    test(`${width}px: header, filters, grid and no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/clips");

      await expect(page.getByRole("heading", { level: 1, name: "Clips" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Latest" })).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("#clips-search")).toBeVisible();
      await expect(page.getByTestId("clips-grid")).toBeVisible();

      const count = await page.locator("[data-clip-code]").count();
      expect(count).toBe(24); // one page, whatever the width

      // A card is one link, and it goes to the clip page. The newest rows in
      // the fixture are adult, so this picks the first ordinary card: an adult
      // card is deliberately not a link at all.
      const ordinary = page.locator("[data-clip-code][data-adult='false']").first();
      expect(await ordinary.locator("a[href^='/clip/']").count()).toBe(1);

      const columns_ = await columns(page);
      if (width < 768) {
        expect(columns_, `${width}px is a single column list`).toBe(1);
      } else {
        expect(columns_, `${width}px is a grid`).toBeGreaterThanOrEqual(2);
      }

      const side = await overflow(page);
      expect(side.scrollWidth, `${width}px overflows: ${JSON.stringify(side.offenders)}`).toBeLessThanOrEqual(
        side.clientWidth + 1,
      );

      // Every target a thumb can hit is at least 44px.
      const target = await page
        .getByRole("tab", { name: "Latest" })
        .evaluate((node) => Math.round(node.getBoundingClientRect().height));
      expect(target).toBeGreaterThanOrEqual(44);

      await shot(page, `clips-index-${width}`);
    });
  }

  test("a removed clip never appears, and an adult clip is a placeholder", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/clips");

    await expect(page.locator("[data-clip-code='gone123']")).toHaveCount(0);

    const placeholder = page.locator("[data-adult='placeholder']").first();
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toContainText("Adult content 18+");
    // No link to the clip and no image: the server stripped both.
    await expect(placeholder.locator("a[href^='/clip/']")).toHaveCount(0);
    await expect(placeholder.locator("img")).toHaveCount(0);
    await expect(placeholder.locator("a[href='/settings']")).toBeVisible();
  });

  test("switching to Most viewed reorders the list and updates the URL", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/clips");

    await page.getByRole("tab", { name: "Most viewed" }).click();
    await expect(page).toHaveURL(/sort=views/);
    await expect(page.getByRole("tab", { name: "Most viewed" })).toHaveAttribute("aria-selected", "true");

    // Fixture 29 has 3,973 views: the highest in the set. Codes come from the
    // real alphabet (no 0/o/1/i/l), which is why they are not zero-padded.
    await expect(page.locator("[data-clip-code]").first()).toHaveAttribute(
      "data-clip-code",
      publicCode(29),
    );
    await shot(page, "clips-sort-views-1280");
  });

  test("search matches the anime title, and an empty result says so", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/clips");

    await page.locator("#clips-search").fill("dandadan");
    await expect(page).toHaveURL(/q=dandadan/);
    await expect(page.locator("[data-clip-code]").first()).toContainText("Dandadan");

    const titles = await page.locator("[data-clip-code][data-adult='false']").allTextContents();
    expect(titles.length).toBeGreaterThan(0);
    // Every surviving card is a Dandadan clip: nothing else matched the title.
    expect(titles.every((text) => /Dandadan/i.test(text))).toBe(true);
    await shot(page, "clips-search-1280");

    await page.locator("#clips-search").fill("zzzzzzzz");
    await expect(page.getByTestId("clips-empty")).toBeVisible();
    await expect(page.getByTestId("clips-empty")).toContainText('No clips match "zzzzzzzz"');
  });

  test("Load more appends the rest instead of replacing the page", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/clips");

    const before = await page.locator("[data-clip-code]").count();
    expect(before).toBe(24);

    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.locator("[data-clip-code]")).toHaveCount(34);
    await expect(page.getByTestId("clips-end")).toBeVisible();
    // The first card is still the first card: nothing was re-sorted. cde4567 is
    // the newest row in the fixture (20 minutes ago).
    await expect(page.locator("[data-clip-code]").first()).toHaveAttribute("data-clip-code", "cde4567");
    await shot(page, "clips-load-more-1280");
  });

  test("a clip card carries the filters into the clip page, and Back restores them", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/clips?sort=views");

    const href = await page
      .locator("[data-clip-code][data-adult='false']")
      .first()
      .locator("a[href^='/clip/']")
      .getAttribute("href");
    expect(href).toContain("from=");

    await page.goto(href ?? "/clips");
    await expect(page.getByTestId("clip-back")).toBeVisible();
    await expect(page.getByTestId("clip-back")).toHaveAttribute("href", "/clips?sort=views");
    await shot(page, "clips-back-link-1280");
  });

  test("the API answers with a cursor and a shared cache, and 304s on a repeat", async ({ page }) => {
    const first = await page.request.get("/api/clips?limit=4");
    expect(first.status()).toBe(200);
    expect(first.headers()["cache-control"]).toContain("public");
    const body = (await first.json()) as { items: Array<{ code: string }>; nextCursor: string | null };
    expect(body.items.length).toBe(4);
    expect(body.nextCursor).toBeTruthy();

    const etag = first.headers()["etag"];
    expect(etag).toBeTruthy();
    const second = await page.request.get("/api/clips?limit=4", {
      headers: { "if-none-match": etag },
    });
    expect(second.status()).toBe(304);

    // The cursor continues exactly where the first page stopped.
    const next = await page.request.get(`/api/clips?limit=4&cursor=${body.nextCursor}`);
    const nextBody = (await next.json()) as { items: Array<{ code: string }> };
    expect(nextBody.items[0].code).not.toBe(body.items[0].code);
    const seen = new Set(body.items.map((item) => item.code));
    expect(nextBody.items.every((item) => !seen.has(item.code))).toBe(true);
  });
});

test.describe("with CLIPS_PUBLIC_ENABLED off", () => {
  test("the API is a 404 and /clips is still My clips", async ({ page }) => {
    const api = await page.request.get(`${OFF}/api/clips`);
    expect(api.status()).toBe(404);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${OFF}/clips`);
    await expect(page.getByRole("heading", { level: 1, name: "My Clips" })).toBeVisible();
    // A guest sees the sign-in prompt, not a public list.
    await expect(page.getByTestId("clips-grid")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Latest" })).toHaveCount(0);
    await shot(page, "clips-flag-off-1280");
  });
});
