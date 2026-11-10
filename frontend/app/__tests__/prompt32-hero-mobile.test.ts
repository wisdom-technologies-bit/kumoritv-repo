// Prompt 32 - the phone hero: equal Watch / Favourite buttons.
//
// The buttons used to be sized by their own label (and by how wide the slide's
// logo happened to be), because `.item_info` is a centred flex column, so the
// grid inside it shrank to its content. These are the layout guards: the phone
// rules must exist, they must live inside `@media (max-width: 767px)`, and no
// desktop block may pick up the phone-only declarations.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const HERO_DIR = join(ROOT, "app/components/HomePage/HeroCarouselHomePage");
const CSS_PATH = join(HERO_DIR, "carouselComponent.module.css");
const TSX_PATH = join(HERO_DIR, "index.tsx");

const css = readFileSync(CSS_PATH, "utf8");
const tsx = readFileSync(TSX_PATH, "utf8");

const PHONES = /@media\s*\(\s*max-width:\s*767px\s*\)/;

type Chunk = { media: string | null; body: string };

/** Every top-level rule / media block, with the media condition it sits in. */
function chunks(source: string): Chunk[] {
  const out: Chunk[] = [];
  let index = 0;

  while (index < source.length) {
    const open = source.indexOf("{", index);
    if (open === -1) break;
    const prelude = source.slice(index, open).trim();
    const mediaAt = prelude.indexOf("@media");

    if (mediaAt > -1) {
      let depth = 1;
      let cursor = open + 1;
      while (cursor < source.length && depth > 0) {
        if (source[cursor] === "{") depth += 1;
        if (source[cursor] === "}") depth -= 1;
        cursor += 1;
      }
      out.push({ media: prelude.slice(mediaAt), body: source.slice(open + 1, cursor - 1) });
      index = cursor;
      continue;
    }

    const close = source.indexOf("}", open);
    if (close === -1) break;
    out.push({ media: null, body: source.slice(open + 1, close) });
    index = close + 1;
  }

  return out;
}

const all = chunks(css);
const phones = all.filter((chunk) => chunk.media && PHONES.test(chunk.media));
const nonPhones = all.filter((chunk) => !chunk.media || !PHONES.test(chunk.media));

test("the hero stylesheet braces stay balanced", () => {
  let depth = 0;
  let lowest = 0;
  for (const character of css) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    lowest = Math.min(lowest, depth);
  }
  assert.equal(depth, 0);
  assert.equal(lowest, 0);
});

test("phones give the info block a definite width", () => {
  assert.ok(phones.length > 0, "there is a max-width: 767px block");

  const block = phones.find(
    (chunk) =>
      /div\.item_info\s*\{/.test(chunk.body) && chunk.body.includes("width: 92%"),
  );
  assert.ok(
    block,
    "`div.item_info` keeps a definite width on phones, so its flex children cannot shrink to content",
  );
});

test("phone buttons are laid out by a single full-width grid column", () => {
  const buttons = phones
    .map((chunk) => chunk.body)
    .find(
      (body) =>
        /\.item_buttons\s*\{/.test(body) && body.includes("grid-template-columns: 1fr"),
    );
  assert.ok(buttons, "`.item_buttons` is one column on phones");

  const rule = buttons!.slice(buttons!.indexOf(".item_buttons"));
  assert.match(rule, /width:\s*100%/, "the button block fills the content column");
  assert.match(rule, /max-width:\s*480px/);
  assert.match(rule, /margin-inline:\s*auto/, "and stays centred");
  assert.match(rule, /align-self:\s*stretch/);
});

test("both buttons are 100% of that column and share one box model", () => {
  const buttons = phones
    .map((chunk) => chunk.body)
    .find((body) => body.includes("grid-template-columns: 1fr"));
  assert.ok(buttons);

  // The `>a` / `>button` pair that makes Watch Now and Favourite equal.
  assert.match(buttons!, /\.item_buttons>a,\s*[\s\S]*?\.item_buttons>button\s*\{/);
  assert.match(buttons!, /width:\s*100%/);
  assert.match(buttons!, /box-sizing:\s*border-box/);
  assert.match(buttons!, /min-height:\s*\d+px/);
  assert.match(buttons!, /white-space:\s*nowrap/, "a label never wraps");
  assert.match(buttons!, /display:\s*flex/);
  assert.match(buttons!, /align-items:\s*center/);

  // The outlined button needs a transparent border, otherwise it is 1px
  // taller than the filled one.
  assert.match(
    buttons!,
    /\.item_buttons>a\s*\{\s*border:\s*1px solid transparent;/,
    "the filled button keeps the outlined button's border box",
  );
});

test("the phone logo can never leave the content column", () => {
  const logo = phones
    .map((chunk) => chunk.body)
    .find((body) => /img\.title_logo\s*\{/.test(body));
  assert.ok(logo, "the logo rules exist on phones");

  assert.match(logo!, /max-width:\s*min\(68%,\s*240px\)/);
  assert.match(logo!, /max-height:\s*84px/);
  assert.match(logo!, /width:\s*auto/);
  assert.match(logo!, /height:\s*auto/, "a fixed height attribute must not fight max-width");
  assert.match(logo!, /object-fit:\s*contain/);
  assert.match(logo!, /margin-inline:\s*auto/);
});

test("a very wide wordmark is capped shorter than a tall one", () => {
  const wide = phones
    .map((chunk) => chunk.body)
    .find((body) => body.includes('img.title_logo[data-wide-logo="true"]'));
  assert.ok(wide, "wide logos have their own cap");
  assert.match(wide!, /max-height:\s*64px/);

  // index.tsx flags them from the stored aspect ratio, nothing else.
  assert.match(tsx, /data-wide-logo=/);
  assert.match(tsx, /currentTitleLogo\.aspectRatio\s*>\s*3\.5/);
});

test("the heading is a fixed row and never narrower than its column", () => {
  const heading = phones.find(
    (chunk) => chunk.body.includes("min-height: 84px") && /h2:has\(img\.title_logo\)/.test(chunk.body),
  );
  assert.ok(heading, "phones pin one heading row height for logo and text slides");
  assert.match(heading!.body, /h2:has\(img\.title_logo\)\s*\{\s*min-width:\s*0;/);
});

test("the info block is shifted down inside the hero", () => {
  const wrapper = phones
    .map((chunk) => chunk.body)
    .find((body) => /\.carousel_position_wrapper\s*\{[^}]*top:\s*-\d+px/.test(body));
  assert.ok(wrapper, "the block starts lower on phones");

  const top = Number(wrapper!.match(/top:\s*(-\d+)px/)![1]);
  assert.ok(top > -40 && top <= -20, `top ${top}px must move the block 20-40px down from -40px`);

  const gaps = phones
    .map((chunk) => chunk.body)
    .find((body) => /div\.item_info\s*\{[^}]*gap:\s*\d+px/.test(body));
  assert.ok(gaps, "the logo / meta / buttons gap is tightened on phones");
  const gap = Number(gaps!.match(/gap:\s*(\d+)px/)![1]);
  assert.ok(gap >= 8 && gap <= 12, `gap ${gap}px stays tight but readable`);
});

test("none of these declarations leaked into a desktop block", () => {
  const leaked = nonPhones.filter((chunk) => {
    const body = chunk.body;
    // Only declarations introduced by Prompt 32; `min-width: 0` and
    // `grid-template-columns: 1fr` also appear in older desktop rules.
    return (
      /data-wide-logo/.test(body) ||
      /grid-template-columns:\s*1fr;/.test(body) ||
      /border:\s*1px solid transparent/.test(body) ||
      /align-content:\s*center/.test(body) ||
      /h2:has\(img\.title_logo\)\s*\{\s*min-width:\s*0;/.test(body)
    );
  });

  assert.deepEqual(
    leaked.map((chunk) => chunk.media ?? "top level"),
    [],
    "phone-only rules must never apply at 768px and above",
  );
  assert.equal(
    nonPhones.some((chunk) => /\.item_buttons\s*\{[^}]*width:\s*100%/.test(chunk.body)),
    false,
    "the desktop button block keeps its own sizing",
  );
});
