// Prompt 40 (B) "BEFORE": measure the DEPLOYED error screen (kumoritv.top).
//
// The resolve route is answered with a 502, which is the "no stream at all"
// state the owner screenshotted (every server dead). Read-only: nothing on the
// site is changed. Run from frontend/:
//
//   node scripts/verify/prompt40/measure-live.mjs
import { chromium } from "@playwright/test";

const SIZES = [
  { name: "360x640", width: 360, height: 640 },
  { name: "390x844", width: 390, height: 844 },
  { name: "1280x720", width: 1280, height: 720 },
];

const MEASURE = `(() => {
  const ov = document.querySelector("[class*='error_overlay']");
  if (!ov) return { found: false };
  const boxEl = document.querySelector("[id*='video_container']");
  const box = boxEl.getBoundingClientRect();
  const r = (el) => el.getBoundingClientRect();
  const icon = r(ov.querySelector("svg"));
  const message = r(ov.querySelector("p"));
  const actionsEl = ov.querySelector("[class*='error_actions']");
  const actions = r(actionsEl);
  const top = Math.min(icon.top, message.top, actions.top);
  const bottom = Math.max(icon.bottom, message.bottom, actions.bottom);
  return {
    found: true,
    overlayH: Math.round(r(ov).height),
    box: { h: Math.round(box.height), w: Math.round(box.width), top: Math.round(box.top) },
    icon: { h: Math.round(icon.height), top: Math.round(icon.top), bottom: Math.round(icon.bottom) },
    message: { top: Math.round(message.top), bottom: Math.round(message.bottom) },
    actions: { top: Math.round(actions.top), bottom: Math.round(actions.bottom), h: Math.round(actions.height) },
    dy: Math.round(Math.abs((top + bottom) / 2 - (box.top + box.height / 2))),
    gapIconMessage: Math.round(message.top - icon.bottom),
    gapMessageActions: Math.round(actions.top - message.bottom),
    actionsHeight: getComputedStyle(actionsEl).height,
    suspiciousRuleMatches: actionsEl.matches("[class*='stage'] > div > div"),
  };
})()`;

const browser = await chromium.launch();
const out = [];

for (const size of SIZES) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  await page.route("**/api/watch/**", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: '{"error":"no_playable_source"}' }),
  );
  await page.goto("https://kumoritv.top/watch/21?ep=7", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("[class*='error_overlay']", { timeout: 60000 });
  await page.waitForTimeout(1200);
  out.push({ size: size.name, fullscreen: false, ...(await page.evaluate(MEASURE)) });
  await page.screenshot({ path: `scripts/verify/prompt40/shots/live-before-${size.name}.png` });

  // Fullscreen: the player box fills the viewport (what `media-player[data-fullscreen]` does).
  await page.evaluate(() => {
    const el = document.querySelector("[id*='video_container']");
    el.dataset.prevStyle = el.getAttribute("style") || "";
    el.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;max-height:none;aspect-ratio:auto;border-radius:0;z-index:9999";
    document.body.style.overflow = "hidden";
  });
  await page.waitForTimeout(400);
  out.push({ size: size.name, fullscreen: true, ...(await page.evaluate(MEASURE)) });
  await page.screenshot({ path: `scripts/verify/prompt40/shots/live-before-${size.name}-fullscreen.png` });
  await page.close();
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
