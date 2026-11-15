// Prompt 40 (B): does the playback-error screen read as ONE centred group?
//
// Runs the REAL stylesheets from this repo (globals.css, the watch page's
// page.module.css and the player's component.module.css) against the REAL DOM
// the player renders in its error state, then measures the group in Chromium.
//
//   node scripts/verify/prompt40/error-overlay-measure.mjs            # current code
//   node scripts/verify/prompt40/error-overlay-measure.mjs --legacy   # HEAD~: the bug
//
// `--legacy` renders the markup and CSS of the commit named by LEGACY_REF
// (default HEAD, i.e. the state before the fix is committed), which is how the
// "before" screenshots in the report were taken.
//
// The player box is `#video_container` (16:9, capped on desktop exactly like
// page.module.css says). Fullscreen is the same box at viewport size, which is
// what a fullscreened media-player element is (fixed, inset 0).

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const legacy = process.argv.includes("--legacy");
const legacyRef = process.env.LEGACY_REF || "HEAD";
const outDir = path.join(root, "scripts/verify/prompt40/shots");
mkdirSync(outDir, { recursive: true });

const read = (file) =>
  legacy
    ? execFileSync("git", ["show", `${legacyRef}:frontend/${file}`], { cwd: root, encoding: "utf8" })
    : readFileSync(path.join(root, file), "utf8");

const css = [
  read("app/globals.css"),
  read("app/watch/[id]/page.module.css"),
  read("app/watch/[id]/components/VideoPlayer/component.module.css"),
].join("\n\n");

// `--white-50` and the font tokens live on :root in globals.css; the app also
// gets them from a theme layer we do not need for a geometry check.
const fallbackTokens = `:root{--white-50:rgba(255,255,255,.5);--white-100:#fff;--white-25:rgba(255,255,255,.25);--brand-color:#8b5cf6;--font-family-sans-serif:system-ui,sans-serif;--font-size--small-1:14px;--font-size--small-2:13px;}`;

const group = legacy
  ? ""
  : `
        <div class="error_group">`;
const groupEnd = legacy ? "" : `</div>`;

const body = `
  <main id="watch">
    <div id="video_container">
      <div class="container">
        <div class="stage">
          <div role="alert" class="error_overlay" data-error-code="no_playable_source">
            ${group}
              <svg class="error_icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6.5 17.5A4.5 4.5 0 0 1 6 8.6a5.5 5.5 0 0 1 10.6-1.4A4 4 0 0 1 17.5 17.5" />
                <path d="M3 3l18 18" />
              </svg>
              <p class="error_message">This video isn&rsquo;t available right now.</p>
              <div class="error_actions">
                <button type="button" class="error_pill" aria-label="Retry">Try again</button>
                <button type="button" class="error_pill">Try another server</button>
              </div>
            ${groupEnd}
          </div>
        </div>
      </div>
    </div>
  </main>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${fallbackTokens}</style>
<style>${css}</style>
<style>body{margin:0;background:#111}</style>
</head><body>${body}</body></html>`;

const file = path.join(outDir, legacy ? "legacy.html" : "current.html");
writeFileSync(file, html);

const VIEWPORTS = [
  { name: "360x640", width: 360, height: 640 },
  { name: "390x844", width: 390, height: 844 },
  { name: "1280x720", width: 1280, height: 720 },
];

// What the eye reads as "the group": the icon, the message and the ACTUAL
// BUTTONS (not their stretched wrapper row), vertically and horizontally.
const FREEFORM = `(() => {
  const box = document.querySelector("[id*='video_container'], #video_container").getBoundingClientRect();
  const overlayEl = document.querySelector(".error_overlay");
  const overlay = overlayEl.getBoundingClientRect();
  const icon = document.querySelector(".error_icon").getBoundingClientRect();
  const message = document.querySelector(".error_message").getBoundingClientRect();
  const actionsEl = document.querySelector(".error_actions");
  const actions = actionsEl.getBoundingClientRect();
  const pills = Array.from(actionsEl.querySelectorAll("button")).map((b) => b.getBoundingClientRect());
  const pillsTop = Math.min(...pills.map((p) => p.top));
  const pillsBottom = Math.max(...pills.map((p) => p.bottom));
  const pillsLeft = Math.min(...pills.map((p) => p.left));
  const pillsRight = Math.max(...pills.map((p) => p.right));
  const top = Math.min(icon.top, message.top, pillsTop);
  const bottom = Math.max(icon.bottom, message.bottom, pillsBottom);
  const left = Math.min(icon.left, message.left, pillsLeft);
  const right = Math.max(icon.right, message.right, pillsRight);
  const outOfBox = top < box.top - 0.5 || bottom > box.bottom + 0.5 || left < box.left - 0.5 || right > box.right + 0.5;
  return {
    box: { h: box.height, w: box.width },
    overlay: { h: overlay.height, w: overlay.width, top: overlay.top },
    icon: { h: icon.height, w: icon.width, top: icon.top, bottom: icon.bottom },
    message: { top: message.top, bottom: message.bottom },
    actions: { h: actions.height, top: actions.top, bottom: actions.bottom },
    pills: { h: pillsBottom - pillsTop, top: pillsTop, bottom: pillsBottom },
    group: { top, bottom, left, right, cy: (top + bottom) / 2, cx: (left + right) / 2 },
    boxCenter: { cy: box.top + box.height / 2, cx: box.left + box.width / 2 },
    gapIconMessage: Math.round(message.top - icon.bottom),
    gapMessageActions: Math.round(pillsTop - message.bottom),
    centered: ((top + bottom) / 2) - (box.top + box.height / 2),
    stretchedActions: Math.round(actions.height - (pillsBottom - pillsTop)),
    outOfBox,
  };
})()`;

const results = [];
const browser = await chromium.launch();

for (const viewport of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  await page.goto(`file://${file}`);
  const reading = await page.evaluate(FREEFORM);
  const dy = Math.abs(reading.group.cy - reading.boxCenter.cy);
  const dx = Math.abs(reading.group.cx - reading.boxCenter.cx);
  results.push({
    viewport: viewport.name,
    fullscreen: false,
    ...reading,
    deltaY: Number(dy.toFixed(1)),
    deltaX: Number(dx.toFixed(1)),
    pass: dy <= 8 && dx <= 2 && !reading.outOfBox && reading.gapIconMessage <= 24,
  });
  await page.screenshot({ path: path.join(outDir, `${legacy ? "before" : "after"}-${viewport.name}.png`) });

  // Fullscreen: the player box becomes the viewport (fixed, inset 0).
  await page.evaluate(() => {
    const container = document.getElementById("video_container");
    container.style.position = "fixed";
    container.style.inset = "0";
    container.style.width = "100vw";
    container.style.height = "100vh";
    container.style.maxHeight = "none";
    container.style.aspectRatio = "auto";
    container.style.borderRadius = "0";
    document.body.style.overflow = "hidden";
  });
  const fs = await page.evaluate(FREEFORM);
  const fsDy = Math.abs(fs.group.cy - fs.boxCenter.cy);
  const fsDx = Math.abs(fs.group.cx - fs.boxCenter.cx);
  results.push({
    viewport: viewport.name,
    fullscreen: true,
    ...fs,
    deltaY: Number(fsDy.toFixed(1)),
    deltaX: Number(fsDx.toFixed(1)),
    pass: fsDy <= 8 && fsDx <= 2 && !fs.outOfBox && fs.gapIconMessage <= 24,
  });
  await page.screenshot({ path: path.join(outDir, `${legacy ? "before" : "after"}-${viewport.name}-fullscreen.png`) });
  await page.close();
}

await browser.close();

const label = legacy ? `BEFORE (${legacyRef})` : "AFTER (working tree)";
console.log(`\n${label} - playback error overlay geometry\n`);
console.log(
  ["viewport", "fs", "box", "icon", "actions h", "gap i/m", "gap m/a", "dy", "dx", "group in box", "verdict"]
    .map((h) => h.padEnd(10))
    .join(""),
);
let failures = 0;
for (const r of results) {
  if (!r.pass) failures++;
  console.log(
    [
      r.viewport,
      r.fullscreen ? "yes" : "no",
      `${Math.round(r.box.w)}x${Math.round(r.box.h)}`,
      `${Math.round(r.icon.w)}px`,
      `${Math.round(r.actions.h)}px`,
      `${r.gapIconMessage}px`,
      `${r.gapMessageActions}px`,
      `${r.deltaY}`,
      `${r.deltaX}`,
      r.outOfBox ? "NO" : "yes",
      r.pass ? "PASS" : "FAIL",
    ]
      .map((value) => String(value).padEnd(10))
      .join(""),
  );
}
console.log(`\n${results.length - failures}/${results.length} measurements inside the tolerance (dy<=8px, dx<=2px)`);
console.log(`screenshots: ${path.relative(root, outDir)}`);
process.exit(failures === 0 ? 0 : 1);
