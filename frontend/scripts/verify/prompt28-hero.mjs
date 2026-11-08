// Prompt 28 browser check for /media/[id].
//
// Measures the three things the prompt asks for, against a real production
// build (`npx next build && npx next start -p 3000`):
//   1. the round bell / plus / heart glyphs are centred in their circles
//      (fails if any glyph centre is more than 1px from the circle centre);
//   2. the compact desktop info grid is 2 x 2, smaller than the Play pill and
//      the round buttons, and sits directly under the actions row;
//   3. on phones the banner is tall and its top is free of text.
//
// Playwright is not a dependency of the site, so it is resolved at runtime from
// PW_MODULE_PATH, a local install, or a global one:
//   PW_MODULE_PATH=/tmp/pw/node_modules node scripts/verify/prompt28-hero.mjs
//
// Usage:
//   node scripts/verify/prompt28-hero.mjs [baseUrl] [--shots dir]
//
// Exit code 0 = every assertion passed. 1 = a measurement is off.
import assert from "node:assert/strict";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const baseUrl = process.argv.find((arg) => arg.startsWith("http")) || "http://localhost:3000";
const shotsFlag = process.argv.indexOf("--shots");
const shotsDir = shotsFlag > -1 ? process.argv[shotsFlag + 1] : null;

function loadPlaywright() {
  const candidates = [
    process.env.PW_MODULE_PATH,
    "/tmp/pw/node_modules",
    join(process.cwd(), "node_modules"),
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      return require(join(dir, "playwright-core"));
    } catch {
      // try the next one
    }
  }

  try {
    return require("playwright-core");
  } catch {
    console.error(
      "playwright-core not found. Set PW_MODULE_PATH to a node_modules folder that has it.",
    );
    process.exit(2);
  }
}

const { chromium } = loadPlaywright();

// CSS-module ids are hashed (`component_hero__mdjuf`), so match on the prefix.
const SEL = {
  banner: '[id^="page_banner_background_container"]',
  hero: '[id^="component_hero__"]',
  actions: '[id^="component_hero_actions"]',
  roundButtons: '[id^="component_btns_actions_container"] > button',
  playPill: '[id^="component_watch_action"] button',
  infoStrip: '[id^="component_info_list_container"]',
  infoItems: '[id^="component_info_list_container"] li',
  titleBlock: '[id^="component_media_title_container"]',
  chips: '[id^="component_genres_and_type_container"]',
};

/** Centre of the union of a button's drawn glyphs, in viewport pixels. */
const GLYPH_CENTRE = `(svg) => {
  const shapes = [...svg.querySelectorAll("path, circle, rect, polygon, polyline, line, ellipse")];
  if (shapes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const shape of shapes) {
    if (typeof shape.getBBox !== "function") continue;

    const box = shape.getBBox();
    const matrix = shape.getScreenCTM();
    if (!matrix) continue;

    // all four corners, so a rotated glyph still yields its axis-aligned bounds
    const corners = [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x, box.y + box.height],
      [box.x + box.width, box.y + box.height],
    ];

    for (const [x, y] of corners) {
      const px = matrix.a * x + matrix.c * y + matrix.e;
      const py = matrix.b * x + matrix.d * y + matrix.f;

      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  }

  if (!Number.isFinite(minX)) return null;

  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, width: maxX - minX, height: maxY - minY };
}`;

async function centring(page) {
  const buttons = await page.$$(SEL.roundButtons);

  const results = [];

  for (const button of buttons) {
    const label = (await button.getAttribute("aria-label")) || "button";

    const measured = await button.evaluate((element, glyphCentreSource) => {
      const svg = element.querySelector("svg");
      const circle = element.getBoundingClientRect();

      if (!svg) return { label: "no svg", dx: null, dy: null };

      // eslint-disable-next-line no-new-func
      const glyph = new Function(`return (${glyphCentreSource})`)()(svg);

      const styles = getComputedStyle(svg);
      const box = svg.getBoundingClientRect();

      return {
        circle: {
          x: circle.left + circle.width / 2,
          y: circle.top + circle.height / 2,
          width: circle.width,
          height: circle.height,
        },
        svgBox: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
        glyph,
        svgStyle: {
          display: styles.display,
          transform: styles.transform,
          position: styles.position,
          margin: styles.margin,
          viewBox: svg.getAttribute("viewBox"),
        },
      };
    }, GLYPH_CENTRE);

    const dx = measured.glyph ? +(measured.glyph.x - measured.circle.x).toFixed(3) : null;
    const dy = measured.glyph ? +(measured.glyph.y - measured.circle.y).toFixed(3) : null;

    results.push({
      label: label.slice(0, 42),
      circle: `${measured.circle.width.toFixed(1)}x${measured.circle.height.toFixed(1)}`,
      svg_viewBox: measured.svgStyle.viewBox,
      svg_transform: measured.svgStyle.transform,
      svg_display: measured.svgStyle.display,
      glyph_w: measured.glyph ? +measured.glyph.width.toFixed(2) : null,
      dx,
      dy,
      offset: dx === null || dy === null ? null : +Math.hypot(dx, dy).toFixed(3),
    });
  }

  return results;
}

async function desktopLayout(page) {
  return page.evaluate((selectors) => {
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();

      return {
        top: +rect.top.toFixed(2),
        bottom: +rect.bottom.toFixed(2),
        left: +rect.left.toFixed(2),
        right: +rect.right.toFixed(2),
        width: +rect.width.toFixed(2),
        height: +rect.height.toFixed(2),
      };
    };

    const strip = document.querySelector(selectors.infoStrip);
    const items = [...document.querySelectorAll(selectors.infoItems)];
    const pill = document.querySelector(selectors.playPill);
    const buttons = [...document.querySelectorAll(selectors.roundButtons)];
    const actions = document.querySelector(selectors.actions);

    // grid columns/rows actually used, from the item positions
    const columns = new Set(items.map((item) => Math.round(item.getBoundingClientRect().left)));
    const rows = new Set(items.map((item) => Math.round(item.getBoundingClientRect().top)));

    const labels = items.map((item) => {
      const label = item.querySelector("span");
      const value = item.querySelector("p");

      return {
        label: label ? label.textContent : null,
        value: value ? value.textContent : null,
        top: +item.getBoundingClientRect().top.toFixed(1),
        left: +item.getBoundingClientRect().left.toFixed(1),
        height: +item.getBoundingClientRect().height.toFixed(1),
        iconWidth: item.querySelector("svg")
          ? +item.querySelector("svg").getBoundingClientRect().width.toFixed(1)
          : null,
      };
    });

    const scrollWidthOverflow = strip
      ? strip.scrollWidth - strip.clientWidth
      : null;

    const documentOverflow =
      document.documentElement.scrollWidth - document.documentElement.clientWidth;

    return {
      pill: box(pill),
      roundButton: box(buttons[0]),
      items: labels,
      itemHeights: items.map((item) => +item.getBoundingClientRect().height.toFixed(1)),
      columns: columns.size,
      rows: rows.size,
      strip: box(strip),
      actions: box(actions),
      gapActionsToStrip:
        strip && actions
          ? +(strip.getBoundingClientRect().top - actions.getBoundingClientRect().bottom).toFixed(1)
          : null,
      stripMaxWidth: strip ? +strip.getBoundingClientRect().width.toFixed(1) : null,
      stripScrollOverflow: scrollWidthOverflow,
      documentOverflow,
      viewport: { width: innerWidth, height: innerHeight },
    };
  }, SEL);
}

async function mobileLayout(page) {
  return page.evaluate((selectors) => {
    const banner = document.querySelector(selectors.banner);
    const bannerRect = banner.getBoundingClientRect();

    const textBlocks = [
      document.querySelector(selectors.titleBlock),
      document.querySelector(selectors.chips),
      document.querySelector(selectors.playPill),
      document.querySelector(selectors.actions),
      document.querySelector(selectors.infoStrip),
    ].filter(Boolean);

    const tops = textBlocks.map((element) => element.getBoundingClientRect().top);
    const firstTextTop = Math.min(...tops);

    const img = banner.querySelector("img");
    const source = banner.querySelector("source");

    return {
      viewport: { width: innerWidth, height: innerHeight },
      banner: {
        top: +bannerRect.top.toFixed(1),
        bottom: +bannerRect.bottom.toFixed(1),
        height: +bannerRect.height.toFixed(1),
        shareOfViewport: +((bannerRect.height / innerHeight) * 100).toFixed(1),
      },
      textFreeHeight: +(firstTextTop - bannerRect.top).toFixed(1),
      textFreeShare: +(((firstTextTop - bannerRect.top) / bannerRect.height) * 100).toFixed(1),
      firstTextTop: +firstTextTop.toFixed(1),
      titleTop: +document.querySelector(selectors.titleBlock).getBoundingClientRect().top.toFixed(1),
      chipsTop: +document.querySelector(selectors.chips).getBoundingClientRect().top.toFixed(1),
      playTop: +document.querySelector(selectors.playPill).getBoundingClientRect().top.toFixed(1),
      infoTop: +document.querySelector(selectors.infoStrip).getBoundingClientRect().top.toFixed(1),
      image: {
        currentSrc: img ? img.currentSrc : null,
        usesCover: img ? img.currentSrc.includes("/cover/") : null,
        sourceMedia: source ? source.getAttribute("media") : null,
        objectFit: img ? getComputedStyle(img).objectFit : null,
        objectPosition: img ? getComputedStyle(img).objectPosition : null,
      },
      documentOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, SEL);
}

async function openAt(page, width, height, path = "/media/21") {
  await page.setViewportSize({ width, height });
  await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });

  // the hero is server rendered, but the artwork still has to arrive before
  // anything is measured
  await page.waitForSelector(SEL.infoStrip, { timeout: 60000 });
  await page.waitForLoadState("load").catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

const report = {};

// Use whatever Chromium the machine already has when the bundled revision is
// missing (`PW_CHROMIUM_PATH` overrides it).
const launchOptions = { args: ["--no-sandbox"] };

if (process.env.PW_CHROMIUM_PATH) launchOptions.executablePath = process.env.PW_CHROMIUM_PATH;

const browser = await chromium.launch(launchOptions).catch(async (error) => {
  const fallback = [
    "/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
  ].find((path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  });

  if (!fallback) throw error;

  return chromium.launch({ ...launchOptions, executablePath: fallback });
});

try {
  const context = await browser.newContext({ deviceScaleFactor: 1 });

  // the local env points Supabase at a port that is not running here; failing
  // those requests fast keeps the page from hanging
  await context.route("**/127.0.0.1:54321/**", (route) => route.abort());

  const page = await context.newPage();

  // Two page loads only: every other reading comes from resizing. The layout is
  // pure CSS, so a resize re-lays-out the page without a navigation.
  async function at(width, height) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(350);
  }

  // ---------------------------------------------------------------- part 1 & 3
  // the anime: STATUS / EPISODES / RELEASE / LENGTH
  await openAt(page, 1440, 900);

  const centreResults = {};

  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    await at(width, height);
    centreResults[`${width}x${height}`] = await centring(page);
  }

  // the open (+) state, where the icon turns into an X
  await at(1440, 900);
  const openButton = (await page.$$(SEL.roundButtons))[1];
  await openButton.click();
  await page.waitForTimeout(500);
  centreResults["1440x900_open_plus"] = await centring(page);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  report.centring = centreResults;

  const layouts = {};

  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
  ]) {
    await at(width, height);
    layouts[`anime_${width}x${height}`] = await desktopLayout(page);

    if (shotsDir && width === 1440) {
      await page.screenshot({ path: join(shotsDir, "desktop-anime-1440.png"), fullPage: false });
    }
  }

  // the phones, on the same anime page
  const phones = {};

  for (const [width, height] of [
    [390, 844],
    [360, 800],
  ]) {
    await at(width, height);
    phones[`anime_${width}x${height}`] = await mobileLayout(page);

    if (shotsDir) {
      await page.screenshot({
        path: join(shotsDir, `mobile-anime-${width}x${height}.png`),
        fullPage: false,
      });
    }
  }

  // ---------------------------------------------------------------- the manga
  // VOLUMES / CHAPTERS instead of EPISODES / LENGTH
  await openAt(page, 1440, 900, "/media/30013");
  layouts["manga_1440x900"] = await desktopLayout(page);

  if (shotsDir) {
    await page.screenshot({ path: join(shotsDir, "desktop-manga-1440.png"), fullPage: false });
  }

  await at(390, 844);
  phones["manga_390x844"] = await mobileLayout(page);

  report.desktop = layouts;
  report.mobile = phones;

  writeFileSync(join(shotsDir || ".", "prompt28-measurements.json"), JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}

// ------------------------------------------------------------------ assertions

const problems = [];

for (const [viewport, rows] of Object.entries(report.centring)) {
  for (const row of rows) {
    if (row.offset === null) {
      problems.push(`${viewport}: ${row.label} has no measurable glyph`);
    } else if (row.offset > 1) {
      problems.push(
        `${viewport}: ${row.label} glyph is ${row.dx}px / ${row.dy}px off centre (${row.offset}px)`,
      );
    }
    if (!row.svg_viewBox) problems.push(`${viewport}: ${row.label} svg has no viewBox`);
  }
}

for (const [name, layout] of Object.entries(report.desktop)) {
  if (layout.columns !== 2 || layout.rows !== 2) {
    problems.push(
      `${name}: info grid is ${layout.columns} columns x ${layout.rows} rows, expected 2 x 2`,
    );
  }

  const tallest = Math.max(...layout.itemHeights);

  if (layout.pill && tallest >= layout.pill.height) {
    problems.push(`${name}: an info item (${tallest}px) is not smaller than the Play pill`);
  }
  if (layout.roundButton && tallest >= layout.roundButton.height) {
    problems.push(
      `${name}: an info item (${tallest}px) is not smaller than the round button (${layout.roundButton.height}px)`,
    );
  }
  if (layout.gapActionsToStrip === null || layout.gapActionsToStrip > 40) {
    problems.push(`${name}: the strip is not directly under the actions row (${layout.gapActionsToStrip}px)`);
  }
  if (layout.stripMaxWidth > 470) {
    problems.push(`${name}: the strip is ${layout.stripMaxWidth}px wide, expected <= 460px`);
  }
  if (layout.documentOverflow > 0) {
    problems.push(`${name}: the page scrolls sideways by ${layout.documentOverflow}px`);
  }
}

for (const [name, layout] of Object.entries(report.mobile)) {
  if (layout.banner.height < 400) {
    problems.push(`${name}: banner is ${layout.banner.height}px tall, expected >= 400px`);
  }
  if (layout.textFreeShare < 60) {
    problems.push(`${name}: only ${layout.textFreeShare}% of the banner is free of text`);
  }
  if (layout.image.usesCover !== true) {
    problems.push(`${name}: the phone did not get the portrait cover (${layout.image.currentSrc})`);
  }
  if (layout.documentOverflow > 0) {
    problems.push(`${name}: the page scrolls sideways by ${layout.documentOverflow}px`);
  }
}

console.log(JSON.stringify(report, null, 2));

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}

console.log("\nAll prompt-28 browser checks passed.");
