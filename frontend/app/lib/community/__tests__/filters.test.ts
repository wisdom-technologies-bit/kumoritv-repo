// Prompt 38E: the chips and the URL they produce, in one place.
// Prompt 38F adds the fifth (Clips), so the count in the first test changed
// from four to five; the order is still the order the bars draw.
import assert from "node:assert/strict";
import test from "node:test";
import { FEED_FILTERS, readFeedFilter } from "../filters";

test("five filters, in the order the bars show them", () => {
  assert.deepEqual(
    FEED_FILTERS.map((filter) => filter.value),
    ["all", "post", "comment", "announcement", "clips"],
  );
});

test("the labels stay short enough for one row at 360px", () => {
  for (const filter of FEED_FILTERS) {
    assert.ok(filter.label.length <= 13, `${filter.label} is too long for the bar`);
    assert.ok(filter.short.length <= 8, `${filter.short} is too long for the phone bar`);
  }
  assert.equal(FEED_FILTERS.find((filter) => filter.value === "comment")?.label, "Comments");
  // Five chips share 336px on a 360px phone, so the phone bar says "News".
  assert.equal(FEED_FILTERS.find((filter) => filter.value === "announcement")?.short, "News");
});

test("?filter=clips reads as the Clips chip, not as an unknown value", () => {
  assert.equal(readFeedFilter("clips"), "clips");
});

test("readFeedFilter maps the URL, and anything unknown is the full feed", () => {
  assert.equal(readFeedFilter("comments"), "all");
  assert.equal(readFeedFilter("comment"), "comment");
  assert.equal(readFeedFilter("post"), "post");
  assert.equal(readFeedFilter("announcement"), "announcement");
  assert.equal(readFeedFilter("ALL"), "all");
  assert.equal(readFeedFilter(undefined), "all");
  assert.equal(readFeedFilter(["comment", "post"]), "comment");
  assert.equal(readFeedFilter(""), "all");
});
