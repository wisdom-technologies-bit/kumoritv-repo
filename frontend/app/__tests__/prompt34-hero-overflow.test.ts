// Prompt 34 Part A - the phone page must never be wider than the screen while a
// hero trailer plays.
//
// Prompt 33 made the frame a 16:9 cover of the slide, but the *only* thing
// keeping that ~980px-wide frame (inside a 360px hero) from widening the
// document was `overflow: hidden` + `contain: paint` on its parent. A
// composited cross-origin iframe can escape that clip on Android Chrome, and
// then the page scrolls sideways again. These guards pin the fix:
//   - the clip is repeated on the frame's own parent (clip-path is applied by
//     the compositor to the layer itself, so it survives a lost paint clip),
//   - the hero band is a hard clip and its own stacking context,
//   - the library never owns the cover transform,
//   - the document is clipped on phones as a last resort.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const CSS = readFileSync(join(ROOT, "app/components/HomePage/HeroCarouselHomePage/carouselComponent.module.css"), "utf8");
const TSX = readFileSync(join(ROOT, "app/components/HomePage/HeroCarouselHomePage/index.tsx"), "utf8");
const GLOBALS = readFileSync(join(ROOT, "app/globals.css"), "utf8");

/** Declarations of every rule whose selector list matches `matcher`. */
function declarations(source: string, matcher: RegExp): string[] {
  const out: string[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(source))) {
    const selectors = match[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (matcher.test(selectors)) out.push(match[2].replace(/\s+/g, " "));
  }
  return out;
}

const declares = (bodies: string[], property: string, value: RegExp) =>
  bodies.some((body) => new RegExp(`(^|;|\\s)${property}\\s*:\\s*${value.source}`, "m").test(body));

test("the hero band is clipped on phones without changing layout anywhere", () => {
  const section = declarations(CSS, /#hero_section_container/);
  assert.ok(declares(section, "overflow-x", /clip/), "overflow-x: clip");
  assert.ok(declares(section, "max-width", /100vw/), "max-width: 100vw");
  // `overflow: hidden` / `contain: paint` on the section stop a 24px child
  // margin collapsing through it and grow the desktop hero by 24px, so they are
  // never used here; the compositor clip is phones-only instead.
  assert.equal(declares(section, "overflow", /hidden/), false, "no layout-shifting overflow on the section");
  assert.equal(declares(section, "contain", /paint|strict/), false, "no layout-shifting containment on the section");

  // The phones-only block repeats the clip on the hero band.
  const phone = CSS.slice(CSS.indexOf("@media (max-width: 767px)"));
  const phoneHero = phone.slice(0, phone.indexOf("/* Prompt 32"));
  assert.match(phoneHero, /#hero_section_container/);
  assert.match(phoneHero, /clip-path:\s*inset\(\s*0\s*\)/);
  assert.match(phoneHero, /isolation:\s*isolate/);
});

test("the frame's own parent crops it with clip-path, not only paint containment", () => {
  const layer = declarations(CSS, /\.video_container(?![\w-])/);
  assert.ok(declares(layer, "overflow", /hidden/), "overflow: hidden");
  assert.ok(declares(layer, "clip-path", /inset\(\s*0\s*\)/), "clip-path: inset(0)");
  assert.ok(declares(layer, "contain", /strict/), "contain: strict");
  // The sizing container must stay on the same box: the cqw/cqh cover maths
  // resolves against it.
  assert.ok(declares(layer, "container-type", /size/), "container-type: size");
  assert.ok(declares(layer, "position", /absolute/), "position: absolute");
  assert.ok(declares(layer, "inset", /0/), "inset: 0");
});

test("the cover framing is still a CSS transform (Prompt 33 output kept)", () => {
  assert.match(CSS, /@supports\s*\(width:\s*1cqw\)/);
  assert.ok(declares(declarations(CSS, /iframe/), "transform", /translate\(\s*-50%\s*,\s*-50%\s*\)\s*scale\(\s*1\.06\s*\)/));
  assert.ok(declares(declarations(CSS, /iframe/), "pointer-events", /none/));
});

test("framer-motion never owns the iframe transform", () => {
  // `motion.iframe` can write an inline `transform` (or `will-change`) that
  // replaces the CSS cover transform. The frame is a plain element; only the
  // wrapping layer is animated, and only in opacity.
  assert.equal(/motion\.iframe/.test(TSX), false, "motion.iframe must not be used for the trailer");
  assert.match(TSX, /<iframe/);
  assert.match(TSX, /initial=\{\{ opacity: 0 \}\}/);
  assert.match(TSX, /animate=\{\{ opacity: 1 \}\}/);
  assert.equal(/motion\.div[^>]*\btransform\b/.test(TSX), false, "no animated transform on the wrapper");
});

test("the document itself cannot scroll sideways on phones", () => {
  const phoneBlock = GLOBALS.slice(GLOBALS.indexOf("@media (max-width: 767px)"));
  assert.ok(phoneBlock.includes("html,\n  body"), "a phone rule targets html and body");
  const rule = phoneBlock.slice(0, phoneBlock.indexOf("}") + 1);
  assert.match(rule, /overflow-x:\s*hidden/);
  assert.match(rule, /overflow-x:\s*clip/);
  assert.match(rule, /max-width:\s*100%/);
  // `clip` must be the value that wins (it does not create a scroll container,
  // so the sticky header keeps working).
  assert.ok(rule.indexOf("overflow-x: clip") > rule.indexOf("overflow-x: hidden"));
});
