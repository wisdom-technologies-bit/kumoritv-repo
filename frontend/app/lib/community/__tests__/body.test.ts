// Prompt 38B: the server-side gate for community writes.
import assert from "node:assert/strict";
import test from "node:test";
import {
  POST_BODY_MAX,
  REPORT_DETAILS_MAX,
  cleanPostBody,
  isProfane,
  validateCreatePost,
  validateCreateReport,
} from "../body";

test("a normal post passes and is trimmed", () => {
  const result = validateCreatePost({ body: "  Frieren episode 12 was perfect  ", isSpoiler: true });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.body, "Frieren episode 12 was perfect");
    assert.equal(result.value.isSpoiler, true);
  }
});

test("empty, whitespace-only and non-string bodies are refused", () => {
  assert.equal(validateCreatePost({ body: "   " }).ok, false);
  assert.equal(validateCreatePost({ body: "" }).ok, false);
  assert.equal(validateCreatePost({ body: 42 }).ok, false);
  assert.equal(validateCreatePost(null).ok, false);
  assert.equal(validateCreatePost([]).ok, false);
});

test("the 1000-character cap is enforced on the server", () => {
  const tooLong = validateCreatePost({ body: "x".repeat(POST_BODY_MAX + 1) });
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.equal(tooLong.error, "body_too_long");

  const atLimit = validateCreatePost({ body: "x".repeat(POST_BODY_MAX) });
  assert.equal(atLimit.ok, true);
});

test("profanity is cleaned server-side, not rejected", () => {
  assert.equal(isProfane("this is fucking great"), true);
  const result = validateCreatePost({ body: "this is fucking great" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(!/\bfucking\b/i.test(result.value.body), "the word is masked");
    assert.match(result.value.body, /\*/);
  }
  assert.equal(isProfane("this is great"), false);
  assert.equal(cleanPostBody("hello"), "hello");
});

test("a non-boolean spoiler flag is refused, not coerced", () => {
  const result = validateCreatePost({ body: "hello", isSpoiler: "yes" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "invalid_spoiler");
});

test("unknown keys are ignored (no clip_id or author can be smuggled in)", () => {
  // Phase 3 reads clip_code and link_url, and still reads nothing else: a raw
  // clip_id, an author_id or a status in the body never reaches the insert.
  const result = validateCreatePost({ body: "hello", clip_id: "abc", author_id: "someone", status: "hidden" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(Object.keys(result.value).sort(), ["body", "clipCode", "isSpoiler", "linkUrl"]);
    assert.equal(result.value.clipCode, null);
    assert.equal(result.value.linkUrl, null);
  }
});

test("a post with no attachment carries neither a code nor a link", () => {
  const result = validateCreatePost({ body: "just words" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.clipCode, null);
    assert.equal(result.value.linkUrl, null);
  }
});

test("clip_code is accepted as a code or as a clip URL, and nothing else", () => {
  const byCode = validateCreatePost({ body: "x", clip_code: "abc2345" });
  assert.equal(byCode.ok, true);
  if (byCode.ok) assert.equal(byCode.value.clipCode, "abc2345");

  const byUrl = validateCreatePost({ body: "x", clip_code: "https://kumoritv.top/clip/abc2345" });
  assert.equal(byUrl.ok, true);
  if (byUrl.ok) assert.equal(byUrl.value.clipCode, "abc2345");

  for (const bad of ["abc234", "abc23456", "https://evil.com/clip/abc2345", "hello", 42]) {
    const result = validateCreatePost({ body: "x", clip_code: bad });
    assert.equal(result.ok, false, `should refuse ${String(bad)}`);
    if (!result.ok) assert.equal(result.error, "invalid_clip");
  }
});

test("a clip URL in link_url becomes a clip, not a link", () => {
  const result = validateCreatePost({
    body: "",
    link_url: "https://kumoritv.top/clip/abc2345",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.clipCode, "abc2345");
    assert.equal(result.value.linkUrl, null);
    assert.equal(result.value.body, "");
  }
});

test("a plain link stays a plain link and is never a clip", () => {
  const result = validateCreatePost({ body: "read this", link_url: "https://example.com/an-article" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.linkUrl, "https://example.com/an-article");
    assert.equal(result.value.clipCode, null);
  }

  // A lookalike host in link_url is a plain link, not an attachment.
  const lookalike = validateCreatePost({ body: "x", link_url: "https://evil.com/clip/abc2345" });
  assert.equal(lookalike.ok, true);
  if (lookalike.ok) {
    assert.equal(lookalike.value.clipCode, null);
    assert.equal(lookalike.value.linkUrl, "https://evil.com/clip/abc2345");
  }
});

test("one attachment per post: clip and plain link cannot both be sent", () => {
  const result = validateCreatePost({
    body: "x",
    clip_code: "abc2345",
    link_url: "https://example.com/article",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "clip_and_link");

  // Two different clips is the same mistake.
  const two = validateCreatePost({
    body: "x",
    clip_code: "abc2345",
    link_url: "https://kumoritv.top/clip/bcd3456",
  });
  assert.equal(two.ok, false);
  if (!two.ok) assert.equal(two.error, "clip_and_link");

  // The same clip twice is one attachment, not an error.
  const same = validateCreatePost({
    body: "x",
    clip_code: "abc2345",
    link_url: "https://kumoritv.top/clip/abc2345",
  });
  assert.equal(same.ok, true);
  if (same.ok) assert.equal(same.value.clipCode, "abc2345");
});

test("a clip makes empty text a complete post; without a clip it is still refused", () => {
  for (const body of ["", "   ", undefined]) {
    const withClip = validateCreatePost({ body, clip_code: "abc2345" });
    assert.equal(withClip.ok, true, `clip-only with body ${String(body)}`);
    if (withClip.ok) assert.equal(withClip.value.body, "");

    const without = validateCreatePost({ body });
    assert.equal(without.ok, false, `no clip, no text: ${String(body)}`);
    if (!without.ok) assert.equal(without.error, "empty_body");
  }
});

test("link validation: only a real http(s) URL is stored", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://kumoritv.top/a", "example.com", "//example.com/a"]) {
    const result = validateCreatePost({ body: "x", link_url: bad });
    assert.equal(result.ok, false, `should refuse ${bad}`);
    if (!result.ok) assert.equal(result.error, "invalid_link");
  }
  assert.equal(
    validateCreatePost({ body: "x", link_url: `https://example.com/${"a".repeat(2000)}` }).ok,
    false,
  );
});

test("profanity in attached text is still cleaned", () => {
  const result = validateCreatePost({ body: "this is fucking great", clip_code: "abc2345" });
  assert.equal(result.ok, true);
  if (result.ok) assert.ok(!/\bfucking\b/i.test(result.value.body));
});

test("report validation: target, reason and details", () => {
  const id = "10000000-0000-0000-0000-000000000001";

  const ok = validateCreateReport({ target_kind: "post", target_id: id, reason: "spam" });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.details, null);

  assert.equal(validateCreateReport({ target_kind: "profile", target_id: id, reason: "spam" }).ok, false);
  assert.equal(validateCreateReport({ target_kind: "post", target_id: "not-a-uuid", reason: "spam" }).ok, false);
  assert.equal(validateCreateReport({ target_kind: "post", target_id: id, reason: "because" }).ok, false);
  assert.equal(
    validateCreateReport({ target_kind: "post", target_id: id, reason: "spam", details: "x".repeat(REPORT_DETAILS_MAX + 1) }).ok,
    false,
  );
  assert.equal(validateCreateReport(null).ok, false);
});
