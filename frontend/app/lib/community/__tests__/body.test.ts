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

test("unknown keys are ignored (no clip or link can be smuggled in)", () => {
  const result = validateCreatePost({ body: "hello", clip_id: "abc", link_url: "https://evil.test" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(Object.keys(result.value).sort(), ["body", "isSpoiler"]);
  }
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
