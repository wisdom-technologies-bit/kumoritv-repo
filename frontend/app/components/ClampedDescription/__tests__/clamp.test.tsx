import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import ClampedDescription from "../index";
import { cleanDescription, stripHtml } from "@/app/lib/text/description";

const LONG = "A".repeat(2000);

test("a 2000 character synopsis renders in full inside the clamp, never truncated in the DOM", () => {
  const html = renderToStaticMarkup(React.createElement(ClampedDescription, { text: LONG }));
  assert.match(html, /data-clamped-description="true"/);
  // The DOM keeps the whole synopsis (the CSS clamps it); `title` repeats it for
  // the hover tooltip, so the run is what matters, not the raw count.
  assert.match(html, /A{2000}/);
});

test("an empty or missing description gets an honest fallback", () => {
  for (const value of ["", null, undefined, "<p></p>", "   "]) {
    const html = renderToStaticMarkup(React.createElement(ClampedDescription, { text: value }));
    assert.match(html, /Description not available\./);
  }
});

test("tags, the (Source: ...) tail and a trailing Note are stripped", () => {
  assert.equal(stripHtml("<p>Hello <b>world</b><br/>again</p>"), "Hello world again");
  assert.equal(
    cleanDescription("<p>Gon sets out.</p><p>(Source: GeyeG Pictures)</p>"),
    "Gon sets out.",
  );
  assert.equal(
    cleanDescription("A hunter's tale. Note: This is the 2011 adaptation."),
    "A hunter's tale.",
  );
  assert.equal(cleanDescription("<p>Plot.</p><p>(Sources: AniList, TMDB)</p>"), "Plot.");
  assert.equal(cleanDescription("Mid-sentence Note: stays put."), "Mid-sentence Note: stays put.");
});

test("the clamp is 4 lines on mobile and 5 on desktop with a max-height fallback", () => {
  const css = readFileSync(new URL("../component.module.css", import.meta.url), "utf8");
  assert.match(css, /-webkit-line-clamp:\s*4/);
  assert.match(css, /max-height:\s*calc\(4 \* 1\.55em\)/);
  assert.match(css, /@media \(min-width: 768px\)/);
  assert.match(css, /-webkit-line-clamp:\s*5/);
  assert.match(css, /max-height:\s*calc\(5 \* 1\.55em\)/);
});

test("both header drop-down panels cap their height and scroll inside themselves", () => {
  for (const path of [
    "../../../layout/header/components/AnimeNavListHover/component.module.css",
    "../../../layout/header/components/MangaNavListHover/component.module.css",
  ]) {
    const css = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(css, /max-height:\s*calc\(100dvh - var\(--header-min-height, 64px\) - 16px\)/, path);
    assert.match(css, /overflow-y:\s*auto/, path);
    assert.match(css, /overscroll-behavior:\s*contain/, path);
  }
});
