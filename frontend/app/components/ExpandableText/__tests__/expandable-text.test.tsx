// ExpandableText: the description clamp on the media page.
//
// The full copy must stay in the DOM (SEO, screen readers) and the toggle must
// only appear when the text really overflows, which is measured - so the tests
// mock the box sizes.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { click, flush, render } from "../../../../test-harness/render";
import ExpandableText from "@/app/components/ExpandableText";

const LONG_TEXT =
  "Frieren is an elf mage who outlives her party. ".repeat(12) +
  "This paragraph is deliberately long enough to overflow five lines.";

function stubSizes(scrollHeight: number, clientHeight: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
}

function restoreSizes() {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
}

test.afterEach(() => {
  restoreSizes();
});

test("renders the whole text, even when it is clamped", async () => {
  stubSizes(400, 96); // overflowing

  const tree = await render(
    <ExpandableText id="description">
      <p>{LONG_TEXT}</p>
    </ExpandableText>,
  );

  assert.ok(tree.container.textContent?.includes("This paragraph is deliberately long enough"), "the text is in the DOM");

  const content = tree.container.querySelector("#expandable-description");

  assert.ok(content, "the clamped box is identifiable");
  assert.equal(content?.textContent, LONG_TEXT, "nothing is truncated in JavaScript");

  await tree.unmount();
});

test("toggles aria-expanded and the button label", async () => {
  stubSizes(400, 96);

  const tree = await render(
    <ExpandableText id="description">
      <p>{LONG_TEXT}</p>
    </ExpandableText>,
  );

  const button = tree.container.querySelector("button");

  assert.ok(button, "the toggle renders when the text overflows");
  assert.equal(button!.getAttribute("type"), "button");
  assert.equal(button!.getAttribute("aria-expanded"), "false");
  assert.equal(button!.getAttribute("aria-controls"), "expandable-description");
  assert.equal(button!.textContent, "Read more");

  await click(button);
  await flush();

  const toggled = tree.container.querySelector("button");

  assert.equal(toggled!.getAttribute("aria-expanded"), "true");
  assert.equal(toggled!.textContent, "Show less");
  assert.ok(tree.container.textContent?.includes("This paragraph is deliberately long enough"), "the text survives the toggle");

  await click(toggled);
  await flush();

  assert.equal(tree.container.querySelector("button")!.getAttribute("aria-expanded"), "false");

  await tree.unmount();
});

test("no toggle when the text fits", async () => {
  stubSizes(96, 96); // exactly one box, no overflow

  const tree = await render(
    <ExpandableText id="description">
      <p>Short description.</p>
    </ExpandableText>,
  );

  assert.equal(tree.container.querySelector("button"), null, "short descriptions show no button");
  assert.ok(tree.container.textContent?.includes("Short description."));

  await tree.unmount();
});

test("the toggle appears once the box overflows after a resize", async () => {
  stubSizes(96, 96);

  const tree = await render(
    <ExpandableText id="description">
      <p>{LONG_TEXT}</p>
    </ExpandableText>,
  );

  assert.equal(tree.container.querySelector("button"), null);

  // The window narrows: the same text now takes more lines than the clamp.
  stubSizes(400, 96);

  window.dispatchEvent(new Event("resize"));
  await flush();

  assert.ok(tree.container.querySelector("button"), "the toggle re-measures on resize");

  await tree.unmount();
});
