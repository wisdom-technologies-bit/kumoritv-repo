// Prompt 36: clip page layout measurements + screenshots.
//
// Runs against a REAL production build (`next build` + `next start`) with the
// local stand-in from stub.mjs (Supabase Auth/PostgREST, AniList, provider,
// video). Nothing leaves the machine.
//
// Usage:
//   SEED_CLIP=1 STUB_PORT=54321 node test-harness/clips-e2e/stub.mjs &
//   source /tmp/buildenv.sh && npx next start -p 3100 &
//   node test-harness/clips-e2e/prompt36-layout.mjs --label after
//
// `--label` names the screenshot folder and the report, so a before/after pair
// can be captured without overwriting the first set.

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argLabel = process.argv.indexOf("--label");
const LABEL = argLabel > -1 ? process.argv[argLabel + 1] : "run";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CLIP = process.env.CLIP_CODE || "93xjyak";
const SHOTS = path.join(here, "screenshots", `prompt36-${LABEL}`);
mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "412x915", width: 412, height: 915 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

const overflowWidths = [320, 360, 390, 412, 600, 768, 1024, 1280, 1440, 1920];

// Exact player boxes the panel must survive, independent of the viewport that
// produced them (320x180 is the phone worst case, 1280x720 the desktop one).
const PLAYER_BOXES = [
  { name: "320x180", width: 320, height: 180 },
  { name: "360x203", width: 360, height: 203 },
  { name: "412x232", width: 412, height: 232 },
  { name: "640x360", width: 640, height: 360 },
  { name: "1280x720", width: 1280, height: 720 },
];

/** Player box, control chrome and button sizes, straight from the DOM. */
const measure = () =>
  (() => {
    const player = document.querySelector("[data-media-player]");
    if (!player) return null;
    const box = player.getBoundingClientRect();
    const slider = player.querySelector(".vds-time-slider");
    const sliderBox = slider ? slider.getBoundingClientRect() : null;
    const playButton = player.querySelector(".vds-play-button");
    const playBox = playButton ? playButton.getBoundingClientRect() : null;
    const buttons = [...player.querySelectorAll(".vds-button")].map((node) => {
      const rect = node.getBoundingClientRect();
      return { w: Math.round(rect.width), h: Math.round(rect.height) };
    });
    return {
      player: {
        w: Math.round(box.width),
        h: Math.round(box.height),
        x: Math.round(box.x),
        y: Math.round(box.y),
        bottom: Math.round(box.bottom),
      },
      // The control bar = the progress slider plus the row above it, measured
      // as "how much chrome sits above the bottom edge of the player".
      controlChrome: sliderBox ? Math.round(box.bottom - sliderBox.top) : null,
      sliderHeight: sliderBox ? Math.round(sliderBox.height) : null,
      playButton: playBox ? { w: Math.round(playBox.width), h: Math.round(playBox.height) } : null,
      buttons,
    };
  })();

const docMetrics = () => {
  const doc = document.documentElement;
  const video = document.querySelector("video");
  return {
    scrollWidth: doc.scrollWidth,
    innerWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
    overflow: doc.scrollWidth > window.innerWidth,
    duration: video && Number.isFinite(video.duration) ? Number(video.duration.toFixed(2)) : 0,
    currentTime: video ? Number(video.currentTime.toFixed(2)) : 0,
    paused: video ? video.paused : null,
  };
};

/** Clip page: player box, details block, and the gutter between them. */
const clipPageGeometry = () => {
  const rect = (node) => {
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return {
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.round(box.width),
      h: Math.round(box.height),
      bottom: Math.round(box.bottom),
    };
  };
  const player = document.querySelector("[data-media-player]");
  const section = document.querySelector("main > section");
  return {
    player: rect(player),
    playerBox: rect(document.querySelector("main > div")),
    info: rect(section),
    gap: player && section ? Math.round(section.getBoundingClientRect().top - player.getBoundingClientRect().bottom) : null,
    // The details card must not be pinned over the player on desktop.
  };
};

/**
 * End panel: is it inside the player, does any of its content leave the player
 * box, and does its content box stay clear of the progress slider?
 */
const endPanelGeometry = () => {
  const node = document.querySelector('[data-testid="clip-end-card"]');
  if (!node) return null;
  const player = document.querySelector("[data-media-player]");
  const playerBox = player.getBoundingClientRect();
  const overlay = node.getBoundingClientRect();
  const card = node.firstElementChild ? node.firstElementChild.getBoundingClientRect() : null;
  const slider = player.querySelector(".vds-time-slider");
  const sliderBox = slider ? slider.getBoundingClientRect() : null;

  const escaped = [...node.querySelectorAll("*")]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0)
    .filter(
      ({ r }) =>
        r.top < playerBox.top - 0.5 ||
        r.left < playerBox.left - 0.5 ||
        r.bottom > playerBox.bottom + 0.5 ||
        r.right > playerBox.right + 0.5,
    )
    .map(({ el, r }) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(/\s+/)[0]} ${Math.round(r.top - playerBox.top)}..${Math.round(r.bottom - playerBox.top)}`);

  const buttonNodes = [...node.querySelectorAll("button, a")];
  const buttons = buttonNodes.map((el) => {
    const rect = el.getBoundingClientRect();
    return {
      text: el.textContent.trim().slice(0, 26),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      row: Math.round(rect.top),
    };
  });

  return {
    overlay: {
      x: Math.round(overlay.x),
      y: Math.round(overlay.y),
      w: Math.round(overlay.width),
      h: Math.round(overlay.height),
    },
    card: card && { w: Math.round(card.width), h: Math.round(card.height) },
    insidePlayer:
      overlay.top >= playerBox.top - 1 &&
      overlay.left >= playerBox.left - 1 &&
      overlay.bottom <= playerBox.bottom + 1 &&
      overlay.right <= playerBox.right + 1,
    // Slides up the player box coordinates, e.g. "p. 12..90".
    escapedContent: escaped,
    // Transparent space between the panel's content and the slider bar.
    clearanceToSlider: card && sliderBox ? Math.round(sliderBox.top - card.bottom) : null,
    buttons,
    // Distinct top edges = how many visual rows the actions occupy.
    buttonRows: new Set(buttons.map((b) => b.row)).size,
  };
};

async function settle(page, ms = 1200) {
  await page.waitForTimeout(ms);
}

/** Play the fixture for real (autoplay, muted) so "playing" shots show video. */
async function play(page) {
  await page.evaluate(async () => {
    const video = document.querySelector("video");
    if (!video) return;
    video.muted = true;
    try {
      await video.play();
    } catch {
      /* ignore */
    }
  });
}

/** Jump the range to its end through the page's own timeupdate handler. */
async function driveToEnd(page) {
  await page.evaluate(() => {
    const video = document.querySelector("video");
    if (video && Number.isFinite(video.duration)) {
      video.currentTime = Math.max(0, video.duration - 0.15);
    }
  });
}

async function openClip(page) {
  await page.goto(`${BASE}/clip/${CLIP}`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-media-player]").waitFor({ timeout: 60_000 });
  await settle(page, 2500);
  await play(page);
  await settle(page, 1500);
}

async function run() {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const report = { label: LABEL, base: BASE, clip: CLIP, viewports: {}, playerBoxes: {}, overflow: [], watch: {} };

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 160)));

    await openClip(page);
    await page.screenshot({ path: path.join(SHOTS, `clip-playing-${vp.name}.png`) });
    const playing = {
      measure: await page.evaluate(measure),
      page: await page.evaluate(clipPageGeometry),
      doc: await page.evaluate(docMetrics),
    };

    const endCard = page.getByTestId("clip-end-card");
    await driveToEnd(page);
    await endCard.waitFor({ timeout: 30_000 }).catch(() => undefined);
    await settle(page, 700);
    await page.screenshot({ path: path.join(SHOTS, `clip-ended-${vp.name}.png`) });
    await page.screenshot({ path: path.join(SHOTS, `clip-ended-${vp.name}-full.png`), fullPage: true });
    const ended = {
      visible: await endCard.isVisible().catch(() => false),
      panel: await page.evaluate(endPanelGeometry),
      doc: await page.evaluate(docMetrics),
    };

    report.viewports[vp.name] = { playing, ended, errors: errors.slice(0, 4) };
    await context.close();
  }

  // ---- exact player boxes ------------------------------------------------
  // The panel has to survive these boxes whatever viewport produced them, so
  // the clip container is pinned to each size for the check.
  {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    await openClip(page);
    await page.getByTestId("clip-end-card").waitFor({ state: "attached", timeout: 1 }).catch(() => undefined);
    await driveToEnd(page);
    await page.getByTestId("clip-end-card").waitFor({ timeout: 30_000 }).catch(() => undefined);
    for (const box of PLAYER_BOXES) {
      await page.evaluate(
        ({ width, height }) => {
          const container = document.querySelector("main > div");
          container.style.width = `${width}px`;
          const frame = container.firstElementChild;
          frame.style.width = `${width}px`;
          frame.style.height = `${height}px`;
          frame.style.aspectRatio = "auto";
        },
        box,
      );
      await settle(page, 500);
      await page.locator("main > div").screenshot({ path: path.join(SHOTS, `panel-${box.name}.png`) });
      report.playerBoxes[box.name] = {
        measure: await page.evaluate(measure),
        panel: await page.evaluate(endPanelGeometry),
        doc: await page.evaluate(docMetrics),
      };
    }
    await context.close();
  }

  // ---- overflow sweep ---------------------------------------------------
  for (const width of overflowWidths) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await openClip(page);
    await driveToEnd(page);
    await page.getByTestId("clip-end-card").waitFor({ timeout: 20_000 }).catch(() => undefined);
    await settle(page, 300);
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      bodyScrollWidth: document.body.scrollWidth,
      horizontalScroll: document.documentElement.scrollWidth > window.innerWidth,
    }));
    report.overflow.push({ width, ...metrics });
    await context.close();
  }

  // ---- watch page (must be unchanged) -----------------------------------
  for (const vp of [
    { name: "390x844", width: 390, height: 844 },
    { name: "1440x900", width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    await page.goto(`${BASE}/watch/21?ep=1`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-media-player]").waitFor({ timeout: 60_000 });
    await settle(page, 3000);
    await play(page);
    await settle(page, 800);
    await page.screenshot({ path: path.join(SHOTS, `watch-${vp.name}.png`) });
    await page.screenshot({ path: path.join(SHOTS, `watch-${vp.name}-full.png`), fullPage: true });
    report.watch[vp.name] = {
      measure: await page.evaluate(measure),
      doc: await page.evaluate(docMetrics),
    };
    await context.close();
  }

  await browser.close();
  writeFileSync(path.join(SHOTS, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
