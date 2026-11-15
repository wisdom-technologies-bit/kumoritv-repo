// Part C regression guard: the comment card must never fall back to the UA
// default (black) text colour on a dark card again.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync(
  new URL("../styles.module.css", import.meta.url),
  "utf8",
);

function block(selector: string): string {
  const match = new RegExp(`(^|\\n)\\${selector}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[2] : "";
}

test("the card states its own text colour instead of inheriting", () => {
  const card = block(".card");
  assert.match(card, /color:\s*var\(--white-100/);
  assert.doesNotMatch(css, /color:\s*inherit/);
});

test("every comment surface carries a colour token", () => {
  for (const selector of [
    ".anime_title",
    ".meta",
    ".chip",
    ".author",
    ".body",
    ".footer",
    ".read_in_thread",
  ]) {
    assert.match(block(selector), /color:/, `${selector} needs an explicit colour`);
  }
  // Body copy is the readable one, not a 50% wash.
  assert.match(block(".body"), /rgba\(255,\s*255,\s*255,\s*0\.92\)/);
  assert.match(block(".footer"), /var\(--white-75/);
});

test("hover and focus are defined so visited/link colours cannot take over", () => {
  assert.match(css, /\.card:hover \.anime_title/);
  assert.match(css, /\.card:focus-visible \.read_in_thread/);
  assert.match(css, /\.card:visited \.anime_title/);
});
