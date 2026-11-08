import assert from "node:assert/strict";
import test from "node:test";
import {
  friendlyWatchError,
  watchErrorCode,
  watchErrorKind,
  WATCH_ERROR_GENERIC,
  WATCH_ERROR_NETWORK,
} from "./errors";

// The exact string the watch route produces when a provider answers with an
// HTML error page instead of JSON (the "Unexpected token '<'" bug).
const JSON_PARSE = 'Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON';

const RAW_SAMPLES = [
  JSON_PARSE,
  "Failed to fetch",
  "HTTP 502",
  "502 Bad Gateway",
  "invalid_embed_url",
  "unsupported_stream_type",
  "stream_recovery_exhausted",
  "hlsError: manifestLoadError",
  "TypeError: Cannot read properties of undefined (reading 'url')",
  "",
  null,
  undefined,
];

test("no friendly message ever leaks the raw error", () => {
  for (const raw of RAW_SAMPLES) {
    const message = friendlyWatchError(raw);
    assert.ok(message.length > 0, `empty message for ${String(raw)}`);
    for (const leak of ["<", "DOCTYPE", "Unexpected token", "JSON", "TypeError", "fetch", "502", "hls"]) {
      assert.ok(
        !message.toLowerCase().includes(leak.toLowerCase()),
        `${leak} leaked into ${message} for raw ${String(raw)}`,
      );
    }
    assert.ok(!/\bat\s+\w+\s+\(/.test(message), `stack text in ${message}`);
  }
});

test("a JSON parse failure maps to the generic message", () => {
  assert.equal(watchErrorKind(JSON_PARSE), "json");
  assert.equal(friendlyWatchError(JSON_PARSE), WATCH_ERROR_GENERIC);
  assert.equal(watchErrorCode(JSON_PARSE), "json");
});

test("a network failure adds the connection hint", () => {
  assert.equal(friendlyWatchError("Failed to fetch"), WATCH_ERROR_NETWORK);
  assert.equal(watchErrorKind("Failed to fetch"), "network");
});

test("an HTTP 502 page maps to the generic message", () => {
  assert.equal(watchErrorKind("HTTP 502"), "http");
  assert.equal(friendlyWatchError("HTTP 502"), WATCH_ERROR_GENERIC);
});

test("stream and HLS failures are recognised", () => {
  assert.equal(watchErrorKind("invalid_embed_url"), "stream");
  assert.equal(watchErrorKind("unsupported_stream_type"), "stream");
  assert.equal(watchErrorKind("stream_recovery_exhausted"), "hls");
  assert.equal(friendlyWatchError("invalid_embed_url"), WATCH_ERROR_GENERIC);
});

test("an unknown string still gets the generic message", () => {
  assert.equal(watchErrorKind("something odd happened"), "unknown");
  assert.equal(friendlyWatchError("something odd happened"), WATCH_ERROR_GENERIC);
});

test("the audio and subtitle context never changes the copy a user sees", () => {
  // DUB fallback is a separate pill, not different wording: one message only.
  assert.equal(
    friendlyWatchError(JSON_PARSE, { audio: "dub", hasSubAlternative: true }),
    WATCH_ERROR_GENERIC,
  );
});
