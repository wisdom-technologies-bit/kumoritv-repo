// Phase 4, part A: the pure rules behind the new-post bar.
//
// nextToast() is the state machine the owner asked to be unit-tested with fake
// timers: throttle, collapse, own items, suppression, the first-load seed and
// the flush. The text and ETag helpers are here too, because every surface
// (toast, pill, route, meta description) uses the same projection.

import assert from "node:assert/strict";
import test from "node:test";
import {
  ADULT_TOAST_TEXT,
  TOAST_MIN_GAP_MS,
  TOAST_VISIBLE_MS,
  initialToastState,
  latestETag,
  nextFlushAt,
  nextToast,
  plainSnippet,
  shapeLatestRow,
  stripMarkdown,
  toastHeadline,
  toastMobileLine,
  truncateWords,
  type LatestItem,
} from "@/app/lib/community/latest";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 17, 12, 0, seconds)).toISOString();

function item(overrides: Partial<LatestItem> = {}): LatestItem {
  return {
    id: overrides.id ?? "post-1",
    kind: "post",
    authorId: "author-1",
    authorName: "Ada",
    authorAvatar: null,
    text: "hello",
    hasClip: false,
    clipThumb: null,
    adult: false,
    href: "/community/post/post-1",
    createdAt: at(0),
    ...overrides,
  };
}

/* --------------------------------- text ---------------------------------- */

test("stripMarkdown turns the announcement sample into one plain line", () => {
  const sample = [
    "# Service Update: KumoriTV Is Back Online!",
    "",
    "We are pleased to announce that **KumoriTV is fully accessible again!**",
    "",
    "- one",
    "- two",
    "",
    "> a quote",
    "",
    "`code` and [a link](https://kumoritv.top) and https://kumoritv.top/x",
  ].join("\n");

  const plain = stripMarkdown(sample);
  assert.equal(plain.includes("#"), false);
  assert.equal(plain.includes("**"), false);
  assert.equal(plain.includes("]("), false);
  assert.ok(plain.includes("KumoriTV is fully accessible again!"), plain);
  assert.ok(plain.includes("a link"), plain);
  assert.equal(plain.includes("\n"), false);
});

test("raw HTML never survives the projection", () => {
  const plain = stripMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>hi');
  assert.equal(/</.test(plain), false, plain);
  assert.ok(plain.includes("hi"));
});

test("truncateWords cuts at a word boundary and marks the cut", () => {
  const text = "a ".repeat(100).trim();
  const cut = truncateWords(text, 20);
  assert.ok(cut.length <= 21, cut);
  assert.ok(cut.endsWith("…"));
  assert.equal(cut.includes("  "), false);
});

test("a long unbroken URL is cut, never left to overflow", () => {
  const url = `https://kumoritv.top/${"x".repeat(300)}`;
  const cut = plainSnippet(url, 140);
  assert.ok(cut.length <= 141, String(cut.length));
});

test("the plain snippet of an empty body is empty, not 'undefined'", () => {
  assert.equal(plainSnippet(null), "");
  assert.equal(plainSnippet(""), "");
  assert.equal(plainSnippet("   "), "");
});

/* --------------------------------- rows ---------------------------------- */

test("a normal row becomes the public item with href from the server", () => {
  const shaped = shapeLatestRow({
    id: "abc",
    kind: "post",
    created_at: at(1),
    author_id: "u1",
    author_name: "Ada",
    author_avatar: "https://cdn/a.png",
    text: "**hi** there",
    has_clip: true,
    clip_thumb: "https://cdn/t.jpg",
    adult: false,
    href: "/community/post/abc",
  });
  assert.ok(shaped);
  assert.equal(shaped?.text, "hi there");
  assert.equal(shaped?.clipThumb, "https://cdn/t.jpg");
  assert.equal(shaped?.href, "/community/post/abc");
});

test("an adult row carries no title, no thumbnail and no avatar, whatever SQL sent", () => {
  const shaped = shapeLatestRow({
    id: "abc",
    kind: "post",
    created_at: at(1),
    author_id: "u1",
    author_name: "Ada",
    author_avatar: "https://cdn/a.png",
    text: "secret hentai title",
    has_clip: true,
    clip_thumb: "https://cdn/leak.jpg",
    adult: true,
    href: "/community/post/abc",
  });
  assert.ok(shaped);
  assert.equal(shaped?.adult, true);
  assert.equal(shaped?.text, ADULT_TOAST_TEXT);
  assert.equal(shaped?.clipThumb, null);
  assert.equal(shaped?.authorAvatar, null);
  assert.equal(JSON.stringify(shaped).includes("leak.jpg"), false);
  assert.equal(JSON.stringify(shaped).includes("secret hentai"), false);
});

test("an announcement keeps its own href", () => {
  const shaped = shapeLatestRow({
    id: "an-1",
    kind: "announcement",
    created_at: at(1),
    author_id: null,
    author_name: "KumoriTV",
    author_avatar: null,
    text: "We are back",
    has_clip: false,
    clip_thumb: null,
    adult: false,
    href: "/community/announcements/an-1",
  });
  assert.equal(shaped?.kind, "announcement");
  assert.equal(shaped?.href, "/community/announcements/an-1");
});

/* --------------------------------- ETag ---------------------------------- */

test("the ETag changes when an item is added and is stable otherwise", () => {
  const a = item({ id: "a", createdAt: at(1) });
  const b = item({ id: "b", createdAt: at(2) });
  const tag1 = latestETag([a, b]);
  assert.equal(latestETag([b, a]), tag1, "order must not matter");
  assert.notEqual(latestETag([a]), tag1);
  assert.match(tag1, /^W\/"/);
});

/* ------------------------------ nextToast -------------------------------- */

test("the first response only seeds the cursor: no backlog toast", () => {
  const decision = nextToast(initialToastState(), 1_000, [item({ id: "a", createdAt: at(5) })]);
  assert.equal(decision.show, null);
  assert.equal(decision.state.cursor, at(5));
});

test("a later response toasts once, with the item", () => {
  const seeded = nextToast(initialToastState(), 1_000, [item({ id: "a", createdAt: at(5) })]).state;
  const decision = nextToast(seeded, 31_000, [item({ id: "b", createdAt: at(10) })]);
  assert.equal(decision.show?.length, 1);
  assert.equal(decision.show?.[0].id, "b");
  assert.equal(decision.state.cursor, at(10));
});

test("the author's own post is skipped, and its cursor still advances", () => {
  const seeded = nextToast(initialToastState(), 1_000, [item({ id: "a", createdAt: at(5) })]).state;
  const decision = nextToast(seeded, 31_000, [item({ id: "mine", createdAt: at(9), authorId: "me" })], {
    viewerId: "me",
  });
  assert.equal(decision.show, null);
  assert.equal(decision.state.cursor, at(9));
});

test("on /community (suppressed) nothing is queued", () => {
  const seeded = nextToast(initialToastState(), 1_000, [item({ id: "a", createdAt: at(5) })]).state;
  const decision = nextToast(seeded, 31_000, [item({ id: "b", createdAt: at(10) })], { suppressed: true });
  assert.equal(decision.show, null);
  assert.equal(decision.state.pending.length, 0);
  assert.equal(decision.state.cursor, at(10));
});

test("one toast per 10 s: the next one waits, items collapse", () => {
  const seeded = nextToast(initialToastState(), 1_000, [item({ id: "a", createdAt: at(5) })]).state;

  // t=30s: the first toast shows.
  const first = nextToast(seeded, 30_000, [item({ id: "b", createdAt: at(10), authorName: "Ada" })]);
  assert.equal(first.show?.length, 1);

  // t=32s: a second post arrives while the toast is on screen (5 s window).
  const during = nextToast(first.state, 32_000, [item({ id: "c", createdAt: at(12), authorName: "Bola" })]);
  assert.equal(during.show, null);
  assert.equal(during.state.pending.length, 1);

  // t=35.2s: the toast has faded; the throttle (10 s from 30 s) still blocks.
  const throttled = nextToast(during.state, 35_200, []);
  assert.equal(throttled.show, null);

  // t=40s: allowed, and the queued item is shown alone.
  const flush = nextToast(throttled.state, 40_000, []);
  assert.equal(flush.show?.length, 1);
  assert.equal(flush.show?.[0].id, "c");
});

test("collapse: several posts in one window become one toast with a count", () => {
  const seeded = nextToast(initialToastState(), 1_000, [item({ id: "a", createdAt: at(5) })]).state;
  const first = nextToast(seeded, 30_000, [item({ id: "b", createdAt: at(10) })]);
  const during = nextToast(first.state, 33_000, [
    item({ id: "c", createdAt: at(12), authorName: "Bola" }),
    item({ id: "d", createdAt: at(13), authorName: "Chidi" }),
  ]);
  const flush = nextToast(during.state, 40_000, []);
  // Only what arrived AFTER the visible toast: the shown one is not repeated.
  assert.equal(flush.show?.length, 2);
  const headline = toastHeadline(flush.show ?? []);
  assert.equal(headline, "Chidi and 1 other posted");
});

test("the throttle is measured from the last shown toast, not the last item", () => {
  const seeded = nextToast(initialToastState(), 1_000, [item({ id: "a", createdAt: at(5) })]).state;
  const first = nextToast(seeded, 30_000, [item({ id: "b", createdAt: at(10) })]);
  assert.equal(first.state.lastShownAt, 30_000);
  // 39.9 s: one 10 s window has not finished.
  const blocked = nextToast(first.state, 30_000 + TOAST_MIN_GAP_MS - 100, []);
  assert.equal(blocked.show, null);
  // 40 s exactly.
  const allowed = nextToast(first.state, 30_000 + TOAST_MIN_GAP_MS, []);
  assert.equal(allowed.show, null, "nothing pending means nothing to show");
});

test("nextFlushAt points at the later of the fade and the throttle", () => {
  const state = {
    cursor: at(5),
    pending: [item({ id: "p", createdAt: at(9) })],
    lastShownAt: 30_000,
    visibleUntil: 35_000,
  };
  assert.equal(nextFlushAt(state, { minGapMs: 10_000 }), 40_000);
  assert.equal(nextFlushAt({ ...state, pending: [], lastShownAt: null, visibleUntil: null }), null);
});

test("a deferred community toast queues but does not show (clip toast wins)", () => {
  const seeded = nextToast(initialToastState(), 1_000, [item({ id: "a", createdAt: at(5) })]).state;
  const deferred = nextToast(seeded, 31_000, [item({ id: "b", createdAt: at(10) })], { defer: true });
  assert.equal(deferred.show, null);
  assert.equal(deferred.state.pending.length, 1);
  const flush = nextToast(deferred.state, 32_000, []);
  assert.equal(flush.show?.[0].id, "b");
});

test("the mobile line is author + text, and never an empty name", () => {
  assert.equal(toastMobileLine([item({ authorName: "Ada", text: "hi" })]), "Ada · hi");
  assert.equal(toastMobileLine([item({ authorName: null, text: "hi" })]), "Someone · hi");
  assert.equal(
    toastMobileLine([item({ kind: "announcement", authorName: null, text: "We are back" })]),
    "KumoriTV · We are back",
  );
});
