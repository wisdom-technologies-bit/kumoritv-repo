// Phase 5: the pure half of the public clip browse.
//
// Everything asserted here runs without a database or a request: parameter
// parsing (including garbage), the opaque keyset cursor, the ILIKE escape, the
// adult rule in the row -> item mapping, the sort key, the ETag, and the
// "back to clips" link that must never become an open redirect.

import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIPS_BROWSE_LIMIT,
  CLIPS_BROWSE_MAX_LIMIT,
  browseEtag,
  clipHref,
  clipsBackHref,
  decodeCursor,
  encodeCursor,
  episodeLine,
  escapeLike,
  filterQueryString,
  formatViews,
  likePattern,
  nextCursorFor,
  readBrowseQuery,
  relativeAge,
  sortKey,
  toBrowseItem,
  type BrowseClipRow,
} from "@/app/lib/clips/browse";

const ID_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ID_B = "9c858901-8a57-4791-81fe-4c455b099bc9";

function row(overrides: Partial<BrowseClipRow> = {}): BrowseClipRow {
  return {
    id: ID_A,
    code: "k7m2p9q",
    anilist_id: 21,
    episode_number: 4,
    start_seconds: 42,
    end_seconds: 57,
    views: 12400,
    created_at: "2026-11-17T12:00:00.000Z",
    user_id: null,
    ...overrides,
  };
}

// ------------------------------------------------------------------ parsing --

test("defaults: latest, no search, no anime, first page, the default size", () => {
  const query = readBrowseQuery({});
  assert.equal(query.sort, "latest");
  assert.equal(query.q, null);
  assert.equal(query.anime, null);
  assert.equal(query.after, null);
  assert.equal(query.limit, CLIPS_BROWSE_LIMIT);
});

test("an unknown sort falls back to latest instead of failing the request", () => {
  assert.equal(readBrowseQuery({ sort: "nope" }).sort, "latest");
  assert.equal(readBrowseQuery({ sort: "views" }).sort, "views");
  assert.equal(readBrowseQuery({ sort: "week" }).sort, "week");
});

test("anime must be a positive integer: 0, -1, 1.5 and text are all ignored", () => {
  assert.equal(readBrowseQuery({ anime: "21" }).anime, 21);
  assert.equal(readBrowseQuery({ anime: "0" }).anime, null);
  assert.equal(readBrowseQuery({ anime: "-1" }).anime, null);
  assert.equal(readBrowseQuery({ anime: "1.5" }).anime, null);
  assert.equal(readBrowseQuery({ anime: "abc" }).anime, null);
});

test("a one-character search is not a search; whitespace is collapsed and capped", () => {
  assert.equal(readBrowseQuery({ q: "n" }).q, null);
  assert.equal(readBrowseQuery({ q: "   " }).q, null);
  assert.equal(readBrowseQuery({ q: "  attack   on  titan " }).q, "attack on titan");
  const long = readBrowseQuery({ q: "a".repeat(200) }).q ?? "";
  assert.equal(long.length, 80);
});

test("limit is clamped into 1..max and a bad limit uses the default", () => {
  assert.equal(readBrowseQuery({ limit: "10" }).limit, 10);
  assert.equal(readBrowseQuery({ limit: "9999" }).limit, CLIPS_BROWSE_MAX_LIMIT);
  assert.equal(readBrowseQuery({ limit: "0" }).limit, CLIPS_BROWSE_LIMIT);
  assert.equal(readBrowseQuery({ limit: "-5" }).limit, CLIPS_BROWSE_LIMIT);
  assert.equal(readBrowseQuery({ limit: "x" }).limit, CLIPS_BROWSE_LIMIT);
});

test("the first value of a repeated parameter wins", () => {
  assert.equal(readBrowseQuery({ sort: ["views", "week"] }).sort, "views");
});

// ------------------------------------------------------------------- cursor --

test("a cursor round-trips, and the sort it was minted for is kept", () => {
  const raw = encodeCursor({ v: 1, sort: "views", key: 12, id: ID_A });
  const decoded = decodeCursor(raw);
  assert.deepEqual(decoded, { v: 1, sort: "views", key: 12, id: ID_A });
  // base64url: no '+', '/' or '=' to be mangled by a URL.
  assert.match(raw, /^[A-Za-z0-9_-]+$/);
});

test("a cursor is bound to its sort: reusing one across sorts is ignored, not obeyed", () => {
  const raw = encodeCursor({ v: 1, sort: "views", key: 12, id: ID_A });
  const query = readBrowseQuery({ sort: "latest", cursor: raw });
  assert.equal(query.after, null);
});

test("tampered and malformed cursors are ignored instead of trusted", () => {
  const good = encodeCursor({ v: 1, sort: "latest", key: "2026-11-17T12:00:00.000Z", id: ID_A });
  assert.ok(decodeCursor(good));
  assert.equal(decodeCursor("not base64!!"), null);
  assert.equal(decodeCursor(""), null);
  assert.equal(decodeCursor(null), null);
  // A hand-written JSON document is not a cursor: the uuid and version are checked.
  const noId = Buffer.from(JSON.stringify({ v: 1, s: "latest", k: 1 })).toString("base64url");
  assert.equal(decodeCursor(noId), null);
  const badId = Buffer.from(JSON.stringify({ v: 1, s: "latest", k: 1, i: "../../etc/passwd" })).toString("base64url");
  assert.equal(decodeCursor(badId), null);
  const badVersion = Buffer.from(JSON.stringify({ v: 2, s: "latest", k: 1, i: ID_A })).toString("base64url");
  assert.equal(decodeCursor(badVersion), null);
  // Long input is rejected before it is parsed.
  assert.equal(decodeCursor("a".repeat(600)), null);
});

// ------------------------------------------------------------------ search --

test("ILIKE wildcards in a search are escaped, so they match literal text", () => {
  assert.equal(escapeLike("100%"), "100\\%");
  assert.equal(escapeLike("a_b"), "a\\_b");
  assert.equal(escapeLike("back\\slash"), "back\\\\slash");
  assert.equal(likePattern("100%"), "%100\\%%");
});

// -------------------------------------------------------------- adult rule --

test("an adult clip keeps its identity out of the shared response", () => {
  const item = toBrowseItem({
    row: row({ views: 9 }),
    anime: { anilistId: 21, title: "Adult Show", isAdult: true },
    authorName: "Ada",
  });
  assert.equal(item.adult, true);
  assert.equal(item.code, "k7m2p9q");
  assert.equal(item.animeTitle, null);
  assert.equal(item.thumb, null);
  assert.equal(item.authorName, null);
  assert.equal(item.episode, null);
  assert.equal(item.start, null);
  assert.equal(item.end, null);
  assert.equal(item.durationSec, null);
  // Counters are not identifying, and they keep the card's meta row honest.
  assert.equal(item.views, 9);
  assert.equal(item.createdAt, "2026-11-17T12:00:00.000Z");
});

test("a normal clip carries its title, episode, range, thumb and author", () => {
  const item = toBrowseItem({
    row: row(),
    anime: { anilistId: 21, title: "One Piece", isAdult: false },
    authorName: "Ada",
  });
  assert.equal(item.adult, false);
  assert.equal(item.animeTitle, "One Piece");
  assert.equal(item.episode, 4);
  assert.equal(item.durationSec, 15);
  assert.equal(item.thumb, "/thumb/21/4");
  assert.equal(item.authorName, "Ada");
  assert.equal(episodeLine(item), "E4 · 0:42-0:57");
});

test("a guest clip (no account) has no author name, and the card says Guest", () => {
  const item = toBrowseItem({ row: row({ user_id: null }), anime: null, authorName: null });
  assert.equal(item.authorName, null);
  assert.equal(item.adult, false); // an unknown anime is not adult by default
  assert.equal(item.animeTitle, null);
});

// ------------------------------------------------------------- pagination --

test("the sort key is the created_at for latest/week and the count for views", () => {
  assert.equal(sortKey(row(), "latest"), "2026-11-17T12:00:00.000Z");
  assert.equal(sortKey(row(), "week"), "2026-11-17T12:00:00.000Z");
  assert.equal(sortKey(row({ views: 7 }), "views"), 7);
});

test("a next cursor exists only when there is another page, and points past the last row", () => {
  const rows = [row({ id: ID_A }), row({ id: ID_B, views: 3 })];
  assert.equal(nextCursorFor(rows, "views", false), null);
  assert.equal(nextCursorFor([], "latest", true), null);
  const raw = nextCursorFor(rows, "views", true);
  assert.ok(raw);
  assert.deepEqual(decodeCursor(raw), { v: 1, sort: "views", key: 3, id: ID_B });
});

// --------------------------------------------------------------- formatting --

test("view counts collapse to 12.4k and 1.2m without inventing precision", () => {
  assert.equal(formatViews(0), "0");
  assert.equal(formatViews(999), "999");
  assert.equal(formatViews(12400), "12.4k");
  assert.equal(formatViews(120000), "120k");
  assert.equal(formatViews(1200000), "1.2m");
  assert.equal(formatViews("nonsense"), "0");
});

test("relative time reads like a person wrote it", () => {
  const now = Date.parse("2026-11-18T12:00:00.000Z");
  assert.equal(relativeAge("2026-11-18T11:59:30.000Z", now), "just now");
  assert.equal(relativeAge("2026-11-18T11:30:00.000Z", now), "30m ago");
  assert.equal(relativeAge("2026-11-18T04:00:00.000Z", now), "8h ago");
  assert.equal(relativeAge("2026-11-15T12:00:00.000Z", now), "3d ago");
  assert.equal(relativeAge("2026-08-18T12:00:00.000Z", now), "3mo ago");
  assert.equal(relativeAge("2024-11-18T12:00:00.000Z", now), "2y ago");
  assert.equal(relativeAge("not a date", now), "");
});

// --------------------------------------------------------------- ETag / URL --

test("the ETag changes when the body changes and is stable when it does not", () => {
  const one = browseEtag('{"items":[],"nextCursor":null}');
  const two = browseEtag('{"items":[],"nextCursor":null}');
  const three = browseEtag('{"items":[{"code":"k7m2p9q"}],"nextCursor":null}');
  assert.equal(one, two);
  assert.notEqual(one, three);
  assert.match(one, /^W\/"[0-9a-f]+-[0-9a-f]+"$/);
});

test("filter query strings keep defaults out and encode the rest", () => {
  assert.equal(filterQueryString({ sort: "latest", q: "", anime: null }), "");
  assert.equal(filterQueryString({ sort: "views", q: "", anime: null }), "?sort=views");
  assert.equal(filterQueryString({ sort: "latest", q: "dr stone", anime: null }), "?q=dr+stone");
  assert.equal(filterQueryString({ sort: "latest", q: "", anime: 21 }), "?anime=21");
});

test("a card links to the singular /clip/{code}, and keeps the filters", () => {
  assert.equal(clipHref("k7m2p9q"), "/clip/k7m2p9q");
  assert.equal(clipHref("k7m2p9q", "?sort=views"), "/clip/k7m2p9q?from=%3Fsort%3Dviews");
});

test("the back link is rebuilt from known fields, so it cannot be an open redirect", () => {
  assert.equal(clipsBackHref(undefined), "/clips");
  assert.equal(clipsBackHref(""), "/clips");
  assert.equal(clipsBackHref("?sort=views"), "/clips?sort=views");
  assert.equal(clipsBackHref("sort=views&q=naruto"), "/clips?sort=views&q=naruto");
  // Garbage and escapes are dropped, never echoed.
  assert.equal(clipsBackHref("?sort=evil"), "/clips");
  assert.equal(clipsBackHref("?tab=mine"), "/clips");
  assert.equal(clipsBackHref("//evil.example"), "/clips");
  // A whole URL is not a query string: the parameter is not "q", so nothing survives.
  assert.equal(clipsBackHref("https://evil.example/clips?q=x"), "/clips");
  // A valid field survives, a smuggled one does not.
  assert.equal(clipsBackHref("?q=naruto&next=https://evil.example"), "/clips?q=naruto");
});
