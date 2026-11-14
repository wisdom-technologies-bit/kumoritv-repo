// Prompt 38E: the four chips and the URL they produce, in one place.
import assert from "node:assert/strict";
import test from "node:test";
import { FEED_FILTERS, readFeedFilter } from "../filters";

test("four filters, in the order the bars show them", () => {
  assert.deepEqual(
    FEED_FILTERS.map((filter) => filter.value),
    ["all", "post", "comment", "announcement"],
  );
});

test("the labels stay short enough for one row at 360px", () => {
  for (const filter of FEED_FILTERS) {
    assert.ok(filter.label.length <= 13, `${filter.label} is too long for the bar`);
  }
  assert.equal(FEED_FILTERS.find((filter) => filter.value === "comment")?.label, "Comments");
});

test("readFeedFilter maps the URL, and anything unknown is the full feed", () => {
  // ?filter=comments (the plural a shared link carries) is the comment feed,
  // not a silent fall back to "all": an unknown value showing everything was
  // the bug that made a shared filtered link look broken.
  assert.equal(readFeedFilter("comments"), "comment");
  assert.equal(readFeedFilter("comment"), "comment");
  assert.equal(readFeedFilter("post"), "post");
  assert.equal(readFeedFilter("announcement"), "announcement");
  assert.equal(readFeedFilter("ALL"), "all");
  assert.equal(readFeedFilter(undefined), "all");
  assert.equal(readFeedFilter(["comment", "post"]), "comment");
  assert.equal(readFeedFilter(""), "all");
});
