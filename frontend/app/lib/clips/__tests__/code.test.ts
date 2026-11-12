// Prompt 35: the 7-character code generator.

import assert from "node:assert/strict";
import test from "node:test";
import { CLIP_CODE_ALPHABET, CLIP_CODE_LENGTH } from "../constants";
import { generateClipCode, generateUniqueClipCode, isClipCode } from "../code";

test("the alphabet has no ambiguous characters", () => {
  for (const banned of ["0", "1", "i", "l", "o"]) {
    assert.equal(CLIP_CODE_ALPHABET.includes(banned), false, `${banned} must not be in the alphabet`);
  }
  assert.equal(new Set(CLIP_CODE_ALPHABET).size, CLIP_CODE_ALPHABET.length, "no duplicates");
});

test("codes are 7 characters from that alphabet", () => {
  for (let run = 0; run < 500; run += 1) {
    const code = generateClipCode();
    assert.equal(code.length, CLIP_CODE_LENGTH);
    assert.ok(isClipCode(code), `not a valid code: ${code}`);
    for (const character of code) {
      assert.ok(CLIP_CODE_ALPHABET.includes(character), `unexpected character ${character}`);
    }
  }
});

test("the generator is deterministic given a byte source", () => {
  const zeros = () => new Uint8Array(64).fill(0);
  assert.equal(generateClipCode(zeros), CLIP_CODE_ALPHABET[0].repeat(CLIP_CODE_LENGTH));

  // Bytes at or above the rejection limit are skipped, not wrapped: 255s are
  // discarded until a usable byte appears, so 1 -> "3" for every character.
  const bytes = (size: number) => {
    const out = new Uint8Array(size);
    out.fill(255);
    out[0] = 1;
    return out;
  };
  assert.equal(generateClipCode(bytes), CLIP_CODE_ALPHABET[1].repeat(CLIP_CODE_LENGTH));
});

test("collisions are retried, and giving up returns null", async () => {
  const taken = new Set<string>();
  let calls = 0;
  const exists = async (code: string) => {
    calls += 1;
    if (calls <= 2) {
      taken.add(code);
      return true;
    }
    return taken.has(code);
  };

  const code = await generateUniqueClipCode(exists);
  assert.ok(code && isClipCode(code));
  assert.ok(calls >= 3);

  let attempts = 0;
  const alwaysTaken = async () => {
    attempts += 1;
    return true;
  };
  assert.equal(await generateUniqueClipCode(alwaysTaken, undefined, 5), null);
  assert.equal(attempts, 5);
});

test("only a 7-character alphabet code is accepted as one", () => {
  for (const value of ["2345670", "abcdefi", "abcdefo", "23456789", "234567", "ABCDEFG", "abcdegl", "", null, 42]) {
    assert.equal(isClipCode(value), false, `accepted ${JSON.stringify(value)}`);
  }
  assert.equal(isClipCode("abc2345"), true);
});
