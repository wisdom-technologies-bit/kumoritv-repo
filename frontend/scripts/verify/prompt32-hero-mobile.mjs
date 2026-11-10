// Prompt 32 browser check: the home hero on phones.
//
// Measures the real production build (`npx next build && npx next start`):
//   1. Watch Now and Favourite have the SAME width and height - on every
//      slide (tall logo, very wide logo, no logo at all) and in both
//      favourite states - and that width comes from the layout (>= 300px at a
//      360px viewport), never from the label;
//   2. the title logo stays inside the content column, never overlaps the meta
//      line, and the block keeps a gap before "Todays Recomendation";
//   3. nothing changed at 768px and above: the desktop column still lays the
//      two buttons out side by side and the phone logo caps are not in effect.
//
// Playwright is not a dependency of the site, so it is resolved at runtime:
//   PW_MODULE_PATH=/tmp/pw/node_modules node scripts/verify/prompt32-hero-mobile.mjs
//
// Usage: node scripts/verify/prompt32-hero-mobile.mjs [baseUrl] [--shots dir]
//        [--slides 6]
//
// Exit code 0 = every assertion passed. 1 = a measurement is off.

import assert from "node:assert/strict";
import { mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);

const baseUrl =
  process.argv.find((arg) => arg.startsWith("http")) || "http://localhost:3000";
const shotsFlag = process.argv.indexOf("--shots");
const shotsDir = shotsFlag > -1 ? process.argv[shotsFlag + 1] : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const slidesFlag = process.argv.indexOf("--slides");
const maxSlides = slidesFlag > -1 ? Number(process.argv[slidesFlag + 1]) : 6;

function loadPlaywright() {
  const candidates = [
    process.env.PW_MODULE_PATH && join(process.env.PW_MODULE_PATH, "playwright"),
    "/tmp/pw/node_modules/playwright",
    join(process.cwd(), "node_modules/playwright"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      /* try the next one */
    }
  }
  throw new Error(
    "Playwright not found. Install it or set PW_MODULE_PATH to a node_modules directory that has it.",
  );
}

const { chromium } = loadPlaywright();

const CHROME =
  process.env.PW_EXECUTABLE ||
  (existsSync("/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome")
    ? "/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome"
    : undefined);

const results = [];
async function check(label, fn) {
  try {
    const detail = await fn();
    results.push({ label, ok: true, detail });
    console.log(`  PASS  ${label}${detail ? ` - ${detail}` : ""}`);
  } catch (error) {
    results.push({ label, ok: false, detail: error.message });
    console.log(`  FAIL  ${label} - ${error.message}`);
  }
}

const round = (value) => Math.round(value * 100) / 100;

const SEL = {
  slide: 'ul[class*="carousel_container"] > li',
  heading: 'ul[class*="carousel_container"] > li h2',
  logo: 'ul[class*="carousel_container"] > li h2 img[class*="title_logo"]',
  meta: 'ul[class*="carousel_container"] > li div[class*="item_info_inside"]',
  buttons: 'ul[class*="carousel_container"] > li div[class*="item_buttons"]',
  watch: 'ul[class*="carousel_container"] > li div[class*="item_buttons"] > a',
  favourite: 'ul[class*="carousel_container"] > li div[class*="item_buttons"] > button',
  recHeading: '[id*="recomendations_container"] h3',
  swiperSlide: '[id*="swiper_list_container"] .swiper-slide',
};

const box = (page, selector) =>
  page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return {
      top: rect.top + window.scrollY,
      bottom: rect.bottom + window.scrollY,
      left: rect.left + window.scrollX,
      right: rect.right + window.scrollX,
      width: rect.width,
      height: rect.height,
    };
  }, selector);

async function openHome(browser, width, height, base) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route("**/api/notifications**", (route) =>
    route.fulfill({ status: 200, json: { notifications: [], unread: 0, blocked: false } }),
  );
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(SEL.buttons, { timeout: 30000 });
  await page.waitForTimeout(600);
  return page;
}

/** Every slide reachable from the "Todays Recomendation" strip. */
async function slideTitles(page) {
  return page.evaluate(
    (sel) => [...document.querySelectorAll(sel)].map((node) => (node.textContent || "").trim().slice(0, 28)),
    SEL.swiperSlide,
  );
}

const browser = await chromium.launch({ executablePath: CHROME });

try {
  // ------------------------------------------------------- phones: the buttons
  for (const [width, height] of [
    [360, 740],
    [390, 844],
    [412, 915],
  ]) {
    const page = await openHome(browser, width, height, baseUrl);
    const titles = await slideTitles(page);
    const slides = Math.min(maxSlides, Math.max(1, titles.length));
    const widths = new Map();

    for (let index = 0; index < slides; index += 1) {
      if (index > 0) {
        await page.locator(SEL.swiperSlide).nth(index).click();
        await page.waitForTimeout(900);
      }

      const name = (await page.evaluate(
        (sel) => (document.querySelector(sel)?.textContent || "").replace(/\s+/g, " ").trim(),
        SEL.heading,
      )).slice(0, 24) || `slide ${index + 1}`;

      const watch = await box(page, SEL.watch);
      const favourite = await box(page, SEL.favourite);
      const logo = await box(page, SEL.logo);
      const meta = await box(page, SEL.meta);
      const buttons = await box(page, SEL.buttons);
      const rec = await box(page, SEL.recHeading);
      const scroll = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        win: window.innerWidth,
      }));

      console.log(
        `  ${width}x${height} "${name}": watch ${round(watch.width)}x${round(watch.height)} ` +
          `fav ${round(favourite.width)}x${round(favourite.height)} ` +
          `logo ${logo ? `${round(logo.width)}x${round(logo.height)} [${round(logo.left)}..${round(logo.right)}]` : "none"} ` +
          `meta ${round(meta.top)} buttons bottom ${round(buttons.bottom)} rec ${round(rec.top)}`,
      );

      widths.set(name, { width: watch.width, height: watch.height, index });

      await check(`${width} "${name}" Watch and Favourite are the same box`, () => {
        assert.ok(
          Math.abs(watch.width - favourite.width) < 0.5,
          `watch ${round(watch.width)} vs favourite ${round(favourite.width)}`,
        );
        assert.ok(
          Math.abs(watch.height - favourite.height) < 0.5,
          `heights differ: ${round(watch.height)} vs ${round(favourite.height)}`,
        );
      });

      await check(`${width} "${name}" the width comes from the layout`, () => {
        const minimum = width === 360 ? 300 : width - 60;
        assert.ok(
          watch.width >= minimum,
          `buttons are ${round(watch.width)}px wide, expected at least ${minimum}px`,
        );
        const labelFree = Math.abs(watch.width - (buttons.width)) < 0.5;
        assert.ok(
          labelFree,
          `button block ${round(buttons.width)} must equal the button width ${round(watch.width)}`,
        );
      });

      await check(`${width} "${name}" a longer label cannot resize it`, async () => {
        const swap = await page.evaluate((sel) => {
          const node = document.querySelector(sel);
          if (!node) return null;
          const before = node.getBoundingClientRect().width;
          const html = node.innerHTML;
          node.innerHTML = html.replace("FAVOURITE", "FAVOURITED");
          const after = node.getBoundingClientRect().width;
          node.innerHTML = html;
          return { before, after };
        }, SEL.favourite);
        assert.ok(swap, "the favourite button is on the page");
        assert.ok(
          Math.abs(swap.before - swap.after) < 0.5,
          `FAVOURITE ${round(swap.before)} -> FAVOURITED ${round(swap.after)}`,
        );
        return `${round(swap.before)}px in both states`;
      });

      await check(`${width} "${name}" the logo stays inside the column`, () => {
        if (!logo) return "text title, nothing to clip";
        const limit = width - 16;
        assert.ok(logo.right <= limit, `logo right ${round(logo.right)} > ${limit}`);
        assert.ok(logo.left >= 0, `logo left ${round(logo.left)} < 0`);
        assert.ok(
          Math.abs(logo.left + logo.width / 2 - (meta.left + meta.width / 2)) <= 1.5,
          "the logo is centred over the meta line",
        );
        return `${round(logo.width)}x${round(logo.height)} inside ${limit}px`;
      });

      await check(`${width} "${name}" logo never overlaps the meta line`, () => {
        if (!logo) return "text title";
        assert.ok(
          logo.bottom <= meta.top - 8,
          `logo bottom ${round(logo.bottom)} vs meta top ${round(meta.top)} (needs 8px)`,
        );
        return `${round(meta.top - logo.bottom)}px clear`;
      });

      await check(`${width} "${name}" the block clears the recommendation strip`, () => {
        assert.ok(
          buttons.bottom <= rec.top - 16,
          `buttons bottom ${round(buttons.bottom)} vs rec top ${round(rec.top)} (needs 16px)`,
        );
        return `${round(rec.top - buttons.bottom)}px clear`;
      });

      await check(`${width} "${name}" no horizontal scroll`, () => {
        assert.ok(scroll.doc <= scroll.win, `document ${scroll.doc}px wide on a ${scroll.win}px screen`);
        return `${scroll.doc}/${scroll.win}`;
      });

      if (shotsDir && width === 390 && index < 3) {
        await page.screenshot({
          path: join(shotsDir, `prompt32-390-${index + 1}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`),
        });
      }
    }

    await check(`${width} the button width is identical on every slide`, () => {
      const sizes = [...widths.entries()];
      const first = sizes[0][1];
      for (const [name, size] of sizes) {
        assert.ok(
          Math.abs(size.width - first.width) < 0.5 && Math.abs(size.height - first.height) < 0.5,
          `"${name}" is ${round(size.width)}x${round(size.height)}, "${sizes[0][0]}" is ${round(first.width)}x${round(first.height)}`,
        );
      }
      return `${sizes.length} slides at ${round(first.width)}x${round(first.height)}`;
    });

    await page.close();
  }

  // ------------------------------------------------------------ desktop guard
  for (const [width, height] of [
    [768, 1024],
    [1024, 768],
    [1366, 768],
    [1920, 1080],
  ]) {
    const page = await openHome(browser, width, height, baseUrl);
    const watch = await box(page, SEL.watch);
    const favourite = await box(page, SEL.favourite);
    const logo = await box(page, SEL.logo);
    const logoCap = await page.evaluate(
      (sel) => {
        const node = document.querySelector(sel);
        return node ? getComputedStyle(node).maxHeight : null;
      },
      SEL.logo,
    );

    await check(`${width} desktop keeps the two buttons side by side`, () => {
      assert.ok(
        favourite.left >= watch.right - 1,
        `watch ends at ${round(watch.right)}, favourite starts at ${round(favourite.left)}`,
      );
      assert.ok(Math.abs(watch.width - favourite.width) < 0.5, "the desktop columns stay equal");
      assert.ok(watch.width < 400, `a ${round(watch.width)}px column is not a full-width phone button`);
      return `${round(watch.width)}px + ${round(favourite.width)}px`;
    });

    await check(`${width} the phone logo caps are not in effect`, () => {
      if (!logo) return "text title, nothing to cap";
      assert.ok(
        logoCap !== "84px" && logoCap !== "64px",
        `the phone max-height (${logoCap}) leaked into the desktop column`,
      );
      return `max-height ${logoCap}`;
    });

    await page.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:\n" + failed.map((result) => ` - ${result.label}: ${result.detail}`).join("\n"));
  process.exit(1);
}
