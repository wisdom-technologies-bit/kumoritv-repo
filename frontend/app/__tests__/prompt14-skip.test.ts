// B — Skip Intro / Outro / Recap: merged ranges, boundaries, auto-skip,
// and the button living INSIDE the player tree.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  mergeSkipRanges,
  isSkipVisible,
  shouldAutoSkip,
  visibleSkipRange,
  skipLabel,
} from "@/app/lib/watch/skip";
import { normalizeIntroOutro } from "@/app/lib/watch/intro";
import { providers } from "./fixtures/anivexa-watch";

const root = process.cwd();

test("anikoto provider ranges are kept (0-89 / 1460-1549)", () => {
  const ranges = mergeSkipRanges({
    intro: { start: 0, end: 89 },
    outro: { start: 1460, end: 1549 },
  });

  assert.deepEqual(ranges.intro, { start: 0, end: 89 });
  assert.deepEqual(ranges.outro, { start: 1460, end: 1549 });
});

test("reanime ranges with the extra title field still merge", () => {
  const normalized = normalizeIntroOutro(providers.reanime);

  assert.deepEqual(normalized.intro, { start: 0, end: 90 });
  assert.deepEqual(normalized.outro, { start: 1459, end: 1549 });

  const merged = mergeSkipRanges(normalized, {}, 1440);
  assert.deepEqual(merged.intro, { start: 0, end: 90 });
});

test("senshi {0,0} is dropped, then AniSkip can fill the gap", () => {
  assert.deepEqual(mergeSkipRanges({ intro: { start: 0, end: 0 } }, {}), {
    intro: null,
    outro: null,
    recap: null,
  });
  // provider invalid -> AniSkip wins
  assert.deepEqual(
    mergeSkipRanges(
      { intro: { start: 0, end: 0 } },
      { intro: { start: 5, end: 95 } },
    ).intro,
    { start: 5, end: 95 },
  );
});

test("a very short 14s outro is valid", () => {
  const ranges = mergeSkipRanges({ outro: { start: 1401, end: 1415 } }, {}, 1440);

  assert.deepEqual(ranges.outro, { start: 1401, end: 1415 });
});

test("provider data wins over AniSkip on overlap", () => {
  const ranges = mergeSkipRanges(
    { intro: { start: 10, end: 100 } },
    { intro: { start: 1, end: 90 } },
  );

  assert.deepEqual(ranges.intro, { start: 10, end: 100 });
});

test("invalid ranges are dropped (reversed, non-finite, beyond duration)", () => {
  assert.equal(mergeSkipRanges({ intro: { start: 90, end: 90 } }).intro, null);
  assert.equal(mergeSkipRanges({ intro: { start: 100, end: 50 } }).intro, null);
  assert.equal(
    mergeSkipRanges({ intro: { start: NaN, end: 50 } }).intro,
    null,
  );
  assert.equal(
    mergeSkipRanges({ intro: { start: 10, end: Infinity } }).intro,
    null,
  );
  // starts beyond the episode duration: unreachable
  assert.equal(
    mergeSkipRanges({ outro: { start: 1500, end: 1540 } }, {}, 1440).outro,
    null,
  );
  // a range starting at 0 is valid
  assert.deepEqual(mergeSkipRanges({ intro: { start: 0, end: 90 } }).intro, {
    start: 0,
    end: 90,
  });
});

test("visibility at the range boundaries", () => {
  const range = { start: 1460, end: 1549 };

  assert.equal(isSkipVisible(1459, range), true); // 1s of grace
  assert.equal(isSkipVisible(1460, range), true);
  assert.equal(isSkipVisible(1546, range), true);
  assert.equal(isSkipVisible(1548, range), false); // 2s before the end
  assert.equal(isSkipVisible(1500, null), false);
  assert.equal(isSkipVisible(NaN, range), false);
});

test("labels: Skip Intro / Outro / Recap", () => {
  assert.equal(skipLabel("intro"), "Skip Intro");
  assert.equal(skipLabel("outro"), "Skip Outro");
  assert.equal(skipLabel("recap"), "Skip Recap");
});

test("auto-skip fires once per range", () => {
  const skipped = new Set<string>();
  const ranges = { intro: { start: 0, end: 89 }, outro: null, recap: null };

  const first = visibleSkipRange(30, ranges);
  assert.deepEqual(first, { key: "intro", range: { start: 0, end: 89 } });
  assert.equal(shouldAutoSkip("intro", skipped, ranges.intro, 30), true);

  skipped.add("intro");
  assert.equal(shouldAutoSkip("intro", skipped, ranges.intro, 31), false);
});

test("no ranges: nothing visible, no crash", () => {
  const ranges = mergeSkipRanges({}, {});

  assert.deepEqual(ranges, { intro: null, outro: null, recap: null });
  assert.equal(visibleSkipRange(0, ranges), null);
  assert.equal(visibleSkipRange(0, null), null);
  assert.equal(visibleSkipRange(0, undefined), null);
});

test("the skip button is rendered INSIDE the MediaPlayer tree", () => {
  const source = readFileSync(
    join(root, "app/watch/[id]/components/VideoPlayer/index.tsx"),
    "utf8",
  );
  const playerOpen = source.indexOf("<MediaPlayer");
  const playerClose = source.indexOf("</MediaPlayer>");
  const button = source.indexOf('data-testid="skip-button"');

  assert.ok(playerOpen > -1 && playerClose > playerOpen, "no MediaPlayer");
  assert.ok(button > -1, "no skip button");
  assert.ok(
    button > playerOpen && button < playerClose,
    "the skip button is outside the player tree, so it would vanish in fullscreen",
  );
});

test("VideoPlayer reads the provider ranges and the autoSkip/autoNext prefs", () => {
  const source = readFileSync(
    join(root, "app/watch/[id]/components/VideoPlayer/index.tsx"),
    "utf8",
  );

  assert.ok(source.includes("mergeSkipRanges"));
  assert.ok(source.includes("data?.intro") && source.includes("data?.outro"));
  assert.ok(source.includes("prefs.autoSkip"));
  assert.ok(source.includes("prefs.autoNext"));
});

test("the skip pill is styled bottom-right with a larger mobile tap target", () => {
  const css = readFileSync(
    join(root, "app/watch/[id]/components/VideoPlayer/component.module.css"),
    "utf8",
  );
  const block = css.slice(css.indexOf("#skip_btn"));

  assert.ok(block.length > 0, "no #skip_btn style");
  assert.ok(/bottom:\s*\d/.test(block), "not pinned to the bottom");
  assert.ok(/right:\s*\d/.test(block), "not pinned to the right");
  // semi-transparent dark background, from the existing colour variables
  assert.ok(
    /var\(--black-\d+\)|rgba\(0,\s*0,\s*0/.test(block),
    "not a semi-transparent pill",
  );
  assert.ok(/@media/.test(css), "no mobile tap target");
});
