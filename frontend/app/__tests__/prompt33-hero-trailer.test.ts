// Prompt 33 Part A - the hero trailer must COVER the hero, not sit in a
// viewport-sized frame next to it.
//
// The old rules sized the player with viewport units (100vw x 114vh, and
// 177.78vh wide on portrait). The hero is not viewport sized, so the 16:9
// player never matched the hero box: bars on desktop, and a 1300-1600px wide
// frame on a 360px phone, which is what made the page wider than the screen on
// Android Chrome. These guards keep the fix from regressing.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const CSS_PATH = join(ROOT, "app/components/HomePage/HeroCarouselHomePage/carouselComponent.module.css");
const TSX_PATH = join(ROOT, "app/components/HomePage/HeroCarouselHomePage/index.tsx");

const css = readFileSync(CSS_PATH, "utf8");
const tsx = readFileSync(TSX_PATH, "utf8");

/** The declarations of every rule whose selector list matches `matcher`. */
function declarations(selectorPattern: RegExp): string[] {
  const out: string[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(css))) {
    const selectors = match[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (selectorPattern.test(selectors)) out.push(match[2]);
  }
  return out;
}

const has = (selector: RegExp, property: string, value: RegExp) =>
  declarations(selector).some((body) =>
    new RegExp(`(^|;|\\s)${property}\\s*:\\s*${value.source}`, "m").test(body.replace(/\s+/g, " ")),
  );

test("no iframe rule is sized in viewport units any more", () => {
  // 114vh / 100vw / 177.78vh frames are exactly the bug: the hero is not
  // viewport sized, so the two boxes can never agree.
  const bad: string[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(css))) {
    if (!/iframe/i.test(match[1])) continue;
    const body = match[2].replace(/\s+/g, " ");
    const sized = /(^|;|\s)(width|height|min-width|min-height|max-width|max-height)\s*:\s*[^;]*\d(vh|vw|dvh|dvw|svh|svw)/.test(body);
    const viewportTransform = /translate[^;]*\b(vh|vw)\b/.test(body);
    if (sized || viewportTransform) bad.push(`${match[1].trim()} => ${body.trim()}`);
  }
  assert.deepEqual(bad, [], `viewport-sized iframe rules survived:\n${bad.join("\n")}`);
});

test("the dead `.video-container` (hyphen) rule is gone", () => {
  // CSS Modules hash per file, so `.video-container` could never match
  // `styles.video_container`. It was a no-op that hid the real bug.
  assert.equal(/\.video-container\b/.test(css), false);
  assert.equal(/aspect-ratio:\s*16\s*\/\s*9[\s\S]{0,80}\.video-container/.test(css), false);
});

test("the trailer layer is a contained, clipped box the size of the slide", () => {
  const selector = /\.video_container(?![\w-])/;
  assert.ok(has(selector, "position", /absolute/), "position: absolute");
  assert.ok(has(selector, "inset", /0/), "inset: 0");
  assert.ok(has(selector, "overflow", /hidden/), "overflow: hidden");
  assert.ok(has(selector, "contain", /paint/), "contain: paint");
  assert.ok(has(selector, "pointer-events", /none/), "pointer-events: none");
  assert.ok(has(selector, "z-index", /0/), "z-index: 0");
  assert.ok(has(selector, "container-type", /size/), "container-type: size");
});

test("the slide is the positioning context for that layer", () => {
  const li = declarations(/carousel_item/).join("\n");
  assert.match(li, /position:\s*relative/);
});

test("the frame is a 16:9 cover of the box, centred, with overscan", () => {
  assert.match(css, /@supports\s*\(width:\s*1cqw\)/);
  assert.ok(has(/iframe/, "width", /max\(\s*100%\s*,\s*calc\(\s*100cqh\s*\*\s*16\s*\/\s*9\s*\)/));
  assert.ok(has(/iframe/, "height", /max\(\s*100%\s*,\s*calc\(\s*100cqw\s*\*\s*9\s*\/\s*16\s*\)/));
  assert.ok(has(/iframe/, "transform", /translate\(\s*-50%\s*,\s*-50%\s*\)\s*scale\(\s*1\.06\s*\)/));
  // ...and a plain fallback for engines without container query units.
  const iframes = declarations(/iframe/).join("\n");
  assert.match(iframes, /width:\s*100%/);
  assert.match(iframes, /height:\s*100%/);
});

test("the hero band is clipped to the viewport as defence in depth", () => {
  const section = declarations(/#hero_section_container/).join("\n");
  assert.match(section, /overflow-x:\s*hidden/);
  assert.match(section, /overflow-x:\s*clip/);
  assert.match(section, /max-width:\s*100vw/);
});

test("the YouTube guard and the fade-in are untouched", () => {
  assert.match(tsx, /isYoutubeTrailer/);
  assert.match(css, /pointer-events:\s*none/);
});
