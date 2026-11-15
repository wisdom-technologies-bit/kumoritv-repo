// Prompt 40 (B): the playback error screen must read as ONE centred group.
//
// The bug was a selector, not a missing declaration: Prompt 31 added
// `.stage > div, .stage > div > div` for vidstack's outlet/provider, but
// vidstack renders custom elements (`media-player`, `media-provider`), so the
// rule never matched the player. Its only real effect was on OUR overlay: its
// `height: 100%` stretched `.error_actions` into a full-height band, so the
// pills floated far below the message (measured on kumoritv.top: a 136px tall
// actions row holding 34px buttons in a 219px player).
//
// These guards keep the cause from coming back; the geometry itself is measured
// in Chromium by scripts/verify/prompt40/error-overlay-measure.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const PLAYER = join(ROOT, "app/watch/[id]/components/VideoPlayer");
// Comments are stripped: the explanation of the removed rule names it.
const CSS = readFileSync(join(PLAYER, "component.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const TSX = readFileSync(join(PLAYER, "index.tsx"), "utf8");

function declarations(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `${selector} must exist`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const line of body.split(";")) {
    const [property, ...rest] = line.split(":");
    const name = property?.trim();
    if (!name || name.startsWith("/*")) continue;
    out[name] = rest.join(":").trim();
  }
  return out;
}

test("no rule hands the overlay's own children the player's height", () => {
  assert.equal(
    /\.stage\s*>\s*div/.test(CSS),
    false,
    "`.stage > div` / `.stage > div > div` only ever matched our overlay; it must not return",
  );
  assert.equal(
    /\.error_(actions|message|icon)[\s\S]{0,200}height:\s*100%/.test(CSS),
    false,
    "no error-child rule may set height: 100%",
  );
});

test("the overlay is one centred column that fills the player box", () => {
  const rule = declarations(CSS, ".error_overlay {");

  assert.equal(rule.display, "flex");
  assert.equal(rule["flex-direction"], "column");
  assert.equal(rule["align-items"], "center");
  assert.equal(rule["justify-content"], "center");
  assert.equal(rule.position, "absolute");
  assert.equal(rule["box-sizing"], "border-box");
  assert.equal(rule["min-height"], "100%", "the overlay is as tall as the player box");
});

test("icon, message and actions live in one group with the same spacing", () => {
  const group = declarations(CSS, ".error_group {");

  assert.equal(group.display, "flex");
  assert.equal(group["flex-direction"], "column");
  assert.equal(group["align-items"], "center");
  assert.equal(group["justify-content"], "center");
  assert.equal(group.gap, "16px", "16px under the icon and 16px under the message");
  assert.equal(group["width"], "100%");

  const actions = declarations(CSS, ".error_actions {");

  assert.equal(actions["flex"], "0 0 auto", "the actions row never grows or stretches");
  assert.equal(declarations(CSS, ".error_message {").flex, "0 0 auto");
});

test("the error icon is 56px on phones and 64px from 768px", () => {
  const icon = declarations(CSS, ".error_icon {");

  assert.equal(icon.width, "56px");
  assert.equal(icon.height, "56px");
  assert.match(
    CSS,
    /@media \(min-width: 768px\) \{\s*\.error_icon \{\s*width: 64px;\s*height: 64px;\s*\}\s*\}/,
    "desktop keeps the larger icon",
  );
});

test("the markup wraps the three children in the group and keeps the copy", () => {
  assert.match(
    TSX,
    /className=\{styles\.error_overlay\}[\s\S]{0,200}className=\{styles\.error_group\}/,
    "the overlay renders one inner group",
  );
  assert.match(TSX, /role="alert"/, "the overlay is still an alert");
  assert.equal(/data-error-code=\{watchErrorCode\(error\)\}/.test(TSX), true);
  assert.equal(
    /\{friendlyError\}/.test(TSX),
    true,
    "the raw error string is still never rendered",
  );
  assert.match(TSX, /ref=\{retryButtonRef\}/, "focus lands on Try again");
  assert.match(TSX, /try again/i, "the retry button keeps its label");
  assert.match(TSX, /onClick=\{\(\) => \{\s*setPlaybackError\(""\);\s*watch\.retry\(\);/, "retry behaviour unchanged");
  assert.match(TSX, /watch\.selectServer\(nextServer\.id\)/, "server switch unchanged");
  assert.match(TSX, /Try another server/, "the second action keeps its label");
});
