// Prompt 35: the per-session view cookie.

import assert from "node:assert/strict";
import test from "node:test";
import { CLIP_SEEN_MAX_CODES } from "../constants";
import { readSeenCodes, rememberSeenCode } from "../views";

test("only well-formed codes survive a round trip", () => {
  assert.deepEqual(readSeenCodes("abc2345, defghjk"), ["abc2345", "defghjk"]);
  assert.deepEqual(readSeenCodes("abc2345,,,nope,ABCDEFG,abcdeg0"), ["abc2345"]);
  assert.deepEqual(readSeenCodes(""), []);
  assert.deepEqual(readSeenCodes(null), []);
  assert.deepEqual(readSeenCodes(42), []);
});

test("a code is added once and moves to the end", () => {
  assert.deepEqual(rememberSeenCode(["abc2345"], "defghjk"), ["abc2345", "defghjk"]);
  assert.deepEqual(rememberSeenCode(["abc2345", "defghjk"], "abc2345"), ["defghjk", "abc2345"]);
});

test("the list stays short: the oldest codes drop off", () => {
  let codes: string[] = [];
  for (let index = 0; index < CLIP_SEEN_MAX_CODES + 5; index += 1) {
    codes = rememberSeenCode(codes, `abc${String(index).padStart(4, "0")}`);
  }
  assert.equal(codes.length, CLIP_SEEN_MAX_CODES);
  assert.equal(codes.includes("abc0000"), false, "the oldest was dropped");
  assert.equal(codes[codes.length - 1], `abc${String(CLIP_SEEN_MAX_CODES + 4).padStart(4, "0")}`);
});
