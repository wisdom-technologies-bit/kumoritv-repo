// Prompt 35: range rules.

import assert from "node:assert/strict";
import test from "node:test";
import { CLIP_MAX_SECONDS_GUEST, CLIP_MAX_SECONDS_USER, CLIP_MIN_SECONDS } from "../constants";
import { moveHandle, quickRange, validateClipRange } from "../range";

test("a normal range is accepted", () => {
  const result = validateClipRange({ start: 42, end: 57 });
  assert.deepEqual(result, { ok: true, start: 42, end: 57 });
});

test("the minimum length is enforced for both limits", () => {
  const short = validateClipRange({ start: 10, end: 10 + CLIP_MIN_SECONDS - 0.5 });
  assert.equal(short.ok, false);
  assert.equal(!short.ok && short.error, "too_short");

  const exact = validateClipRange({ start: 10, end: 10 + CLIP_MIN_SECONDS });
  assert.equal(exact.ok, true);
});

test("guests are capped at 60 s and users at 120 s", () => {
  assert.equal(CLIP_MAX_SECONDS_GUEST, 60);
  assert.equal(CLIP_MAX_SECONDS_USER, 120);

  const guest = validateClipRange({ start: 0, end: 61 }, );
  assert.equal(!guest.ok && guest.error, "too_long");
  assert.match(!guest.ok ? guest.message : "", /60 seconds/);

  const user = validateClipRange({ start: 0, end: 61, maxSeconds: CLIP_MAX_SECONDS_USER });
  assert.equal(user.ok, true);

  const overUser = validateClipRange({ start: 0, end: 121, maxSeconds: CLIP_MAX_SECONDS_USER });
  assert.equal(!overUser.ok && overUser.error, "too_long");
});

test("end must be after start, and equal is refused", () => {
  for (const end of [10, 9, 0]) {
    const result = validateClipRange({ start: 10, end });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.error, "end_before_start");
  }
});

test("a clip that runs past the episode is refused when the duration is known", () => {
  const result = validateClipRange({ start: 100, end: 110, duration: 105 });
  assert.equal(!result.ok && result.error, "past_duration");
  // Within a rounding error is fine.
  assert.equal(validateClipRange({ start: 95, end: 105, duration: 105 }).ok, true);
});

test("non-numbers and negatives are invalid times", () => {
  for (const [start, end] of [
    ["42", 57],
    [42, "57"],
    [null, 57],
    [Number.NaN, 57],
    [-1, 10],
    [0, Number.POSITIVE_INFINITY],
  ] as Array<[unknown, unknown]>) {
    const result = validateClipRange({ start, end });
    assert.equal(!result.ok && result.error, "invalid_time");
  }
});

test("quick mode captures the start and defaults to +15 s", () => {
  assert.deepEqual(quickRange(42, 1440), { start: 42, end: 57 });
  assert.deepEqual(quickRange(0, 1440), { start: 0, end: 15 });
});

test("quick mode slides back near the end instead of producing an invalid clip", () => {
  // 5 s before the end: a 15 s window would overshoot, so it starts earlier.
  assert.deepEqual(quickRange(1435, 1440), { start: 1425, end: 1440 });
  // A very short "episode" still yields the minimum.
  assert.deepEqual(quickRange(10, 12), { start: 0, end: 12 });
  // Unknown duration: no clamp.
  assert.deepEqual(quickRange(30, 0), { start: 30, end: 45 });
});

test("handles cannot cross each other or the length limit", () => {
  const range = { start: 40, end: 55 };

  // Start dragged past the end stops at end - min.
  assert.deepEqual(moveHandle(range, "start", 100), { start: 52, end: 55 });
  // Start cannot go below zero.
  assert.deepEqual(moveHandle(range, "start", -100), { start: 0, end: 55 });
  // End cannot pass start + max.
  assert.deepEqual(moveHandle(range, "end", 500, { maxSeconds: 60 }), { start: 40, end: 100 });
  // End cannot pass the episode.
  assert.deepEqual(moveHandle(range, "end", 500, { duration: 80, maxSeconds: 120 }), { start: 40, end: 80 });
  // End cannot come within the minimum of the start.
  assert.deepEqual(moveHandle(range, "end", -100), { start: 40, end: 43 });
});
