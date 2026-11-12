// Prompt 35: the sliding-window limiter.

import assert from "node:assert/strict";
import test from "node:test";
import { CLIP_RATE_GUEST, CLIP_RATE_USER, CLIP_RATE_WINDOW_MS } from "../constants";
import { createRateLimiter, rateLimitKey } from "../rate-limit";

test("a guest gets 10 clips an hour and the 11th is refused", () => {
  const limiter = createRateLimiter();
  const start = 1_000_000;
  for (let index = 0; index < CLIP_RATE_GUEST; index += 1) {
    const decision = limiter.check("guest:a", CLIP_RATE_GUEST, start + index);
    assert.equal(decision.allowed, true, `hit ${index + 1} should be allowed`);
    assert.equal(decision.remaining, CLIP_RATE_GUEST - index - 1);
    assert.equal(decision.retryAfterSeconds, 0);
  }

  const refused = limiter.check("guest:a", CLIP_RATE_GUEST, start + 10);
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
  assert.ok(refused.retryAfterSeconds > 0);
});

test("a signed-in user gets 60", () => {
  const limiter = createRateLimiter();
  for (let index = 0; index < CLIP_RATE_USER; index += 1) {
    assert.equal(limiter.check("user:1", CLIP_RATE_USER, index).allowed, true);
  }
  assert.equal(limiter.check("user:1", CLIP_RATE_USER, CLIP_RATE_USER).allowed, false);
});

test("keys are independent", () => {
  const limiter = createRateLimiter();
  for (let index = 0; index < CLIP_RATE_GUEST; index += 1) limiter.check("guest:a", CLIP_RATE_GUEST, index);
  assert.equal(limiter.check("guest:a", CLIP_RATE_GUEST, 20).allowed, false);
  assert.equal(limiter.check("guest:b", CLIP_RATE_GUEST, 20).allowed, true);
});

test("the window slides: old hits stop counting", () => {
  const limiter = createRateLimiter();
  const start = 5_000_000;
  for (let index = 0; index < CLIP_RATE_GUEST; index += 1) {
    limiter.check("guest:a", CLIP_RATE_GUEST, start + index * 1000);
  }
  assert.equal(limiter.check("guest:a", CLIP_RATE_GUEST, start + 11_000).allowed, false);

  // One full window after the FIRST hit, that hit has expired.
  const later = start + CLIP_RATE_WINDOW_MS + 1;
  assert.equal(limiter.check("guest:a", CLIP_RATE_GUEST, later).allowed, true);
});

test("the retry hint is in seconds and within the window", () => {
  const limiter = createRateLimiter();
  const now = 9_000_000;
  for (let index = 0; index < 3; index += 1) limiter.check("k", 3, now);
  const refused = limiter.check("k", 3, now + 1000);
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds >= 1);
  assert.ok(refused.retryAfterSeconds <= CLIP_RATE_WINDOW_MS / 1000);
});

test("a flood of keys cannot grow the map without bound", () => {
  const limiter = createRateLimiter({ maxKeys: 3 });
  for (let index = 0; index < 20; index += 1) limiter.check(`key-${index}`, 10, index);
  assert.ok(limiter.size() <= 3, `map grew to ${limiter.size()}`);

  limiter.reset();
  assert.equal(limiter.size(), 0);
});

test("the rate-limit key never contains the raw owner token", () => {
  const ownerHash = "a".repeat(64);
  const key = rateLimitKey({ userId: null, ip: "203.0.113.7", ownerHash });
  assert.match(key, /^guest:203\.0\.113\.7:/);
  assert.ok(key.includes(ownerHash.slice(0, 16)));
  assert.equal(rateLimitKey({ userId: "user-1", ip: "1.2.3.4", ownerHash }), "user:user-1");
  assert.equal(rateLimitKey({}), "guest:unknown:none");
});
