// Prompt 35: `?t=` / `?end=` on a plain watch URL.

import assert from "node:assert/strict";
import test from "node:test";
import { parseWatchRange } from "../url";

test("no params means no seek and no range", () => {
  assert.deepEqual(parseWatchRange({}), { seek: null, range: null });
  assert.deepEqual(parseWatchRange(undefined), { seek: null, range: null });
  assert.deepEqual(parseWatchRange(null), { seek: null, range: null });
});

test("t alone just seeks", () => {
  assert.deepEqual(parseWatchRange({ t: "42" }), { seek: 42, range: null });
  assert.deepEqual(parseWatchRange({ t: "65.5" }), { seek: 65.5, range: null });
});

test("t and end give the same range a clip page has", () => {
  assert.deepEqual(parseWatchRange({ t: "42", end: "57" }), {
    seek: 42,
    range: { start: 42, end: 57 },
  });
});

test("bad values are ignored, never thrown at the viewer", () => {
  for (const t of ["", "abc", "12abc", "1e5", "-5", "0x10", " ", "42,5", "NaN"]) {
    assert.deepEqual(parseWatchRange({ t, end: "57" }), { seek: null, range: null }, `t=${t}`);
  }
});

test("a bad end leaves a plain seek", () => {
  for (const end of ["", "abc", "-1", "1e3", " "]) {
    assert.deepEqual(parseWatchRange({ t: "42", end }), { seek: 42, range: null }, `end=${end}`);
  }
});

test("end at or before start is not a range", () => {
  assert.deepEqual(parseWatchRange({ t: "42", end: "42" }), { seek: 42, range: null });
  assert.deepEqual(parseWatchRange({ t: "42", end: "20" }), { seek: 42, range: null });
});

test("a range shorter than the minimum or longer than the ceiling is dropped", () => {
  // 2 s: too short to be a clip.
  assert.deepEqual(parseWatchRange({ t: "40", end: "42" }), { seek: 40, range: null });
  // 121 s: over the signed-in ceiling.
  assert.deepEqual(parseWatchRange({ t: "0", end: "121" }), { seek: 0, range: null });
  // Exactly the ceiling is fine.
  assert.deepEqual(parseWatchRange({ t: "0", end: "120" }), {
    seek: 0,
    range: { start: 0, end: 120 },
  });
});

test("the duration clamps both ends when it is known", () => {
  assert.deepEqual(parseWatchRange({ t: "1400", end: "1420" }, { duration: 1410 }), {
    seek: 1400,
    range: { start: 1400, end: 1410 },
  });
  // A clamped range that falls under the minimum is not a range.
  assert.deepEqual(parseWatchRange({ t: "1409", end: "1420" }, { duration: 1410 }), {
    seek: 1409,
    range: null,
  });
});

test("repeated params use the first value", () => {
  assert.deepEqual(parseWatchRange({ t: ["42", "9"], end: ["57", "60"] }), {
    seek: 42,
    range: { start: 42, end: 57 },
  });
});

test("numeric params are accepted too", () => {
  assert.deepEqual(parseWatchRange({ t: 42 as unknown as string, end: 57 as unknown as string }), {
    seek: 42,
    range: { start: 42, end: 57 },
  });
});
