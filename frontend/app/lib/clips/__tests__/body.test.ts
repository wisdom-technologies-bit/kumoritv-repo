// Prompt 35: request-body validation for every clips route.

import assert from "node:assert/strict";
import test from "node:test";
import {
  validateClipReportBody,
  validateCreateClipBody,
  validateRenameClipBody,
} from "../body";
import { CLIP_MAX_SECONDS_GUEST, CLIP_MAX_SECONDS_USER } from "../constants";

const valid = { anilistId: 21, episode: 3, start: 42, end: 57, title: " Best fight ", audio: "sub" };

test("a well-formed create body passes and is trimmed", () => {
  const result = validateCreateClipBody(valid, CLIP_MAX_SECONDS_GUEST);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    anilistId: 21,
    episode: 3,
    start: 42,
    end: 57,
    title: "Best fight",
    audio: "sub",
  });
});

test("an optional title, audio or both may be absent", () => {
  const result = validateCreateClipBody(
    { anilistId: 21, episode: 1, start: 0, end: 10 },
    CLIP_MAX_SECONDS_GUEST,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.title, null);
    assert.equal(result.value.audio, null);
  }
});

test("the ids must be positive integers", () => {
  for (const patch of [
    { anilistId: 0 },
    { anilistId: -5 },
    { anilistId: "21" },
    { anilistId: 21.5 },
    { anilistId: 3_000_000_000 },
    { episode: 0 },
    { episode: -1 },
    { episode: 1.5 },
    { episode: "3" },
    { episode: 100_000 },
  ]) {
    const result = validateCreateClipBody({ ...valid, ...patch }, CLIP_MAX_SECONDS_GUEST);
    assert.equal(result.ok, false, `accepted ${JSON.stringify(patch)}`);
    assert.match(!result.ok ? result.error : "", /^invalid_(anilist_id|episode)$/);
  }
});

test("the range is validated on the server, with the caller's ceiling", () => {
  const guest = validateCreateClipBody({ ...valid, start: 0, end: 90 }, CLIP_MAX_SECONDS_GUEST);
  assert.equal(!guest.ok && guest.error, "too_long");

  const user = validateCreateClipBody({ ...valid, start: 0, end: 90 }, CLIP_MAX_SECONDS_USER);
  assert.equal(user.ok, true);

  const backwards = validateCreateClipBody({ ...valid, start: 60, end: 40 }, CLIP_MAX_SECONDS_USER);
  assert.equal(!backwards.ok && backwards.error, "end_before_start");

  const short = validateCreateClipBody({ ...valid, start: 10, end: 11 }, CLIP_MAX_SECONDS_USER);
  assert.equal(!short.ok && short.error, "too_short");

  const pastDay = validateCreateClipBody(
    { ...valid, start: 0, end: 90_000 },
    CLIP_MAX_SECONDS_USER,
  );
  assert.equal(!pastDay.ok && pastDay.error, "invalid_time");
});

test("times must arrive as numbers, not strings", () => {
  const result = validateCreateClipBody({ ...valid, start: "42" }, CLIP_MAX_SECONDS_GUEST);
  assert.equal(!result.ok && result.error, "invalid_time");
});

test("the title follows the title rules", () => {
  const long = validateCreateClipBody({ ...valid, title: "x".repeat(81) }, CLIP_MAX_SECONDS_GUEST);
  assert.equal(!long.ok && long.error, "title_too_long");

  const notText = validateCreateClipBody({ ...valid, title: 42 }, CLIP_MAX_SECONDS_GUEST);
  assert.equal(!notText.ok && notText.error, "title_invalid");

  const blank = validateCreateClipBody({ ...valid, title: "   " }, CLIP_MAX_SECONDS_GUEST);
  assert.equal(blank.ok, true);
  if (blank.ok) assert.equal(blank.value.title, null);
});

test("audio is sub, dub or absent", () => {
  const bad = validateCreateClipBody({ ...valid, audio: "raw" }, CLIP_MAX_SECONDS_GUEST);
  assert.equal(!bad.ok && bad.error, "invalid_audio");
  const dub = validateCreateClipBody({ ...valid, audio: "dub" }, CLIP_MAX_SECONDS_GUEST);
  assert.equal(dub.ok && dub.value.audio, "dub");
});

test("a body that is not an object is refused", () => {
  for (const body of [null, undefined, [], "x", 42, true]) {
    const result = validateCreateClipBody(body, CLIP_MAX_SECONDS_GUEST);
    assert.equal(!result.ok && result.error, "invalid_body");
  }
});

test("report bodies need a known reason", () => {
  assert.deepEqual(validateClipReportBody({ reason: "spam" }), {
    ok: true,
    value: { reason: "spam", details: null },
  });
  assert.equal(validateClipReportBody({ reason: "Copyright" }).ok, true);

  for (const body of [{}, { reason: "nonsense" }, { reason: 42 }, null, []]) {
    const result = validateClipReportBody(body);
    assert.equal(!result.ok && result.error, "invalid_report");
  }

  const long = validateClipReportBody({ reason: "other", details: "x".repeat(501) });
  assert.equal(!long.ok && long.error, "report_too_long");

  const cleaned = validateClipReportBody({ reason: "other", details: "  line\nbreak  " });
  assert.equal(cleaned.ok && cleaned.value.details, "line break");
});

test("rename bodies need a title key, which may be null", () => {
  assert.deepEqual(validateRenameClipBody({ title: " New name " }), {
    ok: true,
    value: { title: "New name" },
  });
  assert.deepEqual(validateRenameClipBody({ title: null }), { ok: true, value: { title: null } });
  assert.equal(!validateRenameClipBody({}).ok, true);
  assert.equal(!validateRenameClipBody({ title: "x".repeat(81) }).ok, true);
  assert.equal(!validateRenameClipBody(null).ok, true);
});
