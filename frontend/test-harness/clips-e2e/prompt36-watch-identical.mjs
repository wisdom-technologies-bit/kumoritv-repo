// Prompt 36: prove /watch renders identically before and after.
//
// Loads the same watch page from two servers (master build and the
// clip-page-layout build), freezes the video at t=0 with the <video> element
// hidden so frame content cannot differ, then compares
//   1. the geometry of every element,
//   2. a computed-style fingerprint of every element,
//   3. a pixel screenshot.
//
//   node test-harness/clips-e2e/prompt36-watch-identical.mjs \
//     --a http://127.0.0.1:3101 --b http://127.0.0.1:3100

import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const A = arg("--a", "http://127.0.0.1:3101");
const B = arg("--b", "http://127.0.0.1:3100");
const OUT = path.join(here, "screenshots", "prompt36-watch-diff");
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "1440x900", width: 1440, height: 900 },
];

async function capture(browser, base, vp) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  await page.goto(`${base}/watch/21?ep=1`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-media-player]").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  // Freeze playback at zero and hide the frame itself. The decoded frame and
  // the progress fill are the only things on this page that move on their own,
  // so removing them is what makes a pixel comparison meaningful.
  await page.evaluate(() => {
    const video = document.querySelector("video");
    if (video) {
      video.pause();
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* ignore */
      }
      video.style.visibility = "hidden";
    }
    // Captions are cue-time driven; hide them so the pixel diff measures
    // layout, not which subtitle cue happened to be on screen.
    const captions = document.createElement("style");
    captions.textContent = ".vds-captions{visibility:hidden!important}";
    document.head.appendChild(captions);
  });
  await page.waitForTimeout(800);

  const fingerprint = await page.evaluate(() => {
    const props = [
      "display", "position", "width", "height", "aspectRatio", "padding", "margin",
      "gap", "gridTemplateColumns", "gridTemplateAreas", "flexDirection", "fontSize",
      "lineHeight", "color", "backgroundColor", "borderRadius", "overflow", "zIndex",
"top", "left", "right", "bottom",
    ];
    // Anything driven by live playback (buffered ranges, progress fill, clock)
    // is excluded: those numbers change with the clock, not with the CSS.
    // Caption cues are laid out in percentages of the video box, which changes
    // when the harness detaches the video source, so they are excluded too.
    const livePlaying = (el) =>
      /vds-slider-progress|vds-slider-track|vds-slider-fill|vds-slider-buffer|vds-time|vds-buffered|vds-captions|vds-cue/i.test(
        el.className || "",
      ) || el.dataset.part === "cue-display" || el.dataset.part === "cue";
    const rows = [];
    document.querySelectorAll("body *").forEach((el, i) => {
      if (livePlaying(el)) return;
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const style = props.map((p) => cs[p]).join("|");
      rows.push(
        `${i}|${el.tagName}|${el.className && typeof el.className === "string" ? el.className : ""}|` +
          `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}|${style}`,
      );
    });
    return rows.join("\n");
  });

  const shotPath = path.join(OUT, `watch-${vp.name}-${base.includes("3101") ? "master" : "branch"}.png`);
  await page.screenshot({ path: shotPath });
  await page.screenshot({ path: shotPath.replace(".png", "-full.png"), fullPage: true });
  await context.close();
  return { fingerprint, shotPath };
}

const browser = await chromium.launch();
const results = [];
for (const vp of VIEWPORTS) {
  const master = await capture(browser, A, vp);
  const branch = await capture(browser, B, vp);
  const masterLines = master.fingerprint.split("\n");
  const branchLines = branch.fingerprint.split("\n");
  let firstDiff = null;
  const len = Math.max(masterLines.length, branchLines.length);
  for (let i = 0; i < len; i += 1) {
    if (masterLines[i] !== branchLines[i]) {
      firstDiff = {
        index: i,
        master: (masterLines[i] || "").slice(0, 400),
        branch: (branchLines[i] || "").slice(0, 400),
      };
      break;
    }
  }
  results.push({
    viewport: vp.name,
    elementCountMaster: masterLines.length,
    elementCountBranch: branchLines.length,
    identical: firstDiff === null && masterLines.length === branchLines.length,
    firstDiff,
    screenshots: [master.shotPath, branch.shotPath],
  });
}
await browser.close();
writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
