// Prompt 35: the time parser and formatter.

import assert from "node:assert/strict";
import test from "node:test";
import { formatRange, formatTime, parseTimeInput } from "../time";

test("m:ss, h:mm:ss and plain seconds all parse", () => {
  assert.equal(parseTimeInput("1:05"), 65);
  assert.equal(parseTimeInput("01:05:09"), 3909);
  assert.equal(parseTimeInput("65"), 65);
  assert.equal(parseTimeInput("65.5"), 65.5);
  assert.equal(parseTimeInput("0:00"), 0);
  assert.equal(parseTimeInput("0:0"), 0);
  assert.equal(parseTimeInput(" 2:30 "), 150);
  assert.equal(parseTimeInput("1:05:00"), 3900);
  assert.equal(parseTimeInput("59:59"), 3599);
});

test("invalid times are null, never a number", () => {
  for (const value of [
    "",
    "   ",
    "abc",
    "1:2:3:4",
    "1:60",
    "1:05:60",
    "0:65",
    "-1",
    "-1:05",
    "1:-5",
    "1,,5",
    "1,5",
    "12:34:56:78",
    "1e3",
    "Infinity",
    "NaN",
    "1:05:09:0",
    "25:00:00",
    null,
    undefined,
    true,
    {},
    [],
  ]) {
    assert.equal(parseTimeInput(value), null, `expected null for ${JSON.stringify(value)}`);
  }
});

test("plain numbers are seconds and negatives are refused", () => {
  assert.equal(parseTimeInput(42), 42);
  assert.equal(parseTimeInput(42.25), 42.25);
  assert.equal(parseTimeInput(-1), null);
  assert.equal(parseTimeInput(Number.NaN), null);
  assert.equal(parseTimeInput(Number.POSITIVE_INFINITY), null);
});

test("every displayed time is m:ss", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(42), "0:42");
  assert.equal(formatTime(65), "1:05");
  assert.equal(formatTime(65.9), "1:05");
  assert.equal(formatTime(3909), "65:09");
  assert.equal(formatTime(-3), "0:00");
  assert.equal(formatTime(null), "0:00");
  assert.equal(formatTime("nope"), "0:00");
});

test("a range label is the shape the metadata uses", () => {
  assert.equal(formatRange(42, 57), "0:42-0:57");
  assert.equal(formatRange(65, 3909), "1:05-65:09");
});
