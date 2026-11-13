/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures and stub transports carry deliberately malformed payloads */
// ani subtitle tracks -> the watch subtitle shape, every playable track, ordered.

import assert from "node:assert/strict";
import test from "node:test";
import { mapAniSubtitles } from "@/app/lib/ani/subtitles";
import { SUBTITLES } from "./standin";

test("every playable track is listed, with the provider's own label", () => {
  const subs = mapAniSubtitles(SUBTITLES, "en");
  assert.deepEqual(
    subs.map((track) => track.label).sort(),
    ["Arabic", "English", "English - Signs", "Portuguese - Brazil"],
  );
  // Nothing is invented and nothing is verified.
  assert.ok(subs.every((track) => !("verified" in track)));
  assert.ok(subs.every((track) => !("language_verified" in track)));
});

test("a track that is not playable never reaches the CC menu", () => {
  const subs = mapAniSubtitles(SUBTITLES, "en");
  assert.equal(
    subs.some((track) => track.label === "Thumbnails"),
    false,
  );
  assert.equal(
    subs.some((track) => track.url.endsWith(".jpg")),
    false,
  );
});

test("lang is the API's own language code, and und when it is unknown", () => {
  const subs = mapAniSubtitles(SUBTITLES, "en");
  assert.equal(subs.find((track) => track.label === "Arabic")?.lang, "ar");
  assert.equal(subs.find((track) => track.label === "English")?.lang, "en");
  assert.equal(
    subs.find((track) => track.label === "Portuguese - Brazil")?.lang,
    "pt",
  );
  const [unknown] = mapAniSubtitles(
    [{ url: "https://dramahot.top/x.vtt", label: "Track 1", playable: true }],
    "en",
  );
  assert.equal(unknown.lang, "und");
});

test("the provider default comes first, then sublang, then English, then the rest", () => {
  assert.deepEqual(
    mapAniSubtitles(SUBTITLES, "ar").map((track) => track.label),
    ["English", "Arabic", "English - Signs", "Portuguese - Brazil"],
  );
  assert.deepEqual(
    mapAniSubtitles(SUBTITLES, "pt").map((track) => track.label),
    ["English", "Portuguese - Brazil", "English - Signs", "Arabic"],
  );
  assert.deepEqual(
    mapAniSubtitles(SUBTITLES, "en").map((track) => track.label),
    ["English", "English - Signs", "Arabic", "Portuguese - Brazil"],
  );
});

test("exactly one track is the default, and it is the provider's own flag", () => {
  const subs = mapAniSubtitles(SUBTITLES, "ar");
  assert.equal(subs.filter((track) => track.default).length, 1);
  assert.equal(subs.find((track) => track.default)?.label, "English");
});

test("with no provider default the sublang preference becomes the default", () => {
  const subs = mapAniSubtitles(
    [
      { url: "https://dramahot.top/a.vtt", label: "Arabic", language: "ar", playable: true, kind: "full" },
      { url: "https://dramahot.top/b.vtt", label: "English", language: "en", playable: true, kind: "full" },
    ],
    "ar",
  );
  assert.equal(subs[0].label, "Arabic");
  assert.equal(subs[0].default, true);
  assert.equal(subs[1].default, false);
});

test("duplicate urls and unusable kinds are dropped", () => {
  const subs = mapAniSubtitles(
    [
      { url: "https://dramahot.top/a.vtt", label: "English", language: "en", playable: true, kind: "full" },
      { url: "https://dramahot.top/a.vtt", label: "English again", language: "en", playable: true, kind: "full" },
      { url: "https://dramahot.top/t.vtt", label: "Sprite", language: "und", playable: true, kind: "unknown" as any },
      { url: "", label: "Empty", playable: true, kind: "full" },
    ],
    "en",
  );
  assert.equal(subs.length, 1);
  assert.equal(subs[0].label, "English");
});

test("ids are stable positions, so the player's track list is deterministic", () => {
  const subs = mapAniSubtitles(SUBTITLES, "en");
  assert.deepEqual(
    subs.map((track) => track.id),
    ["sub-1", "sub-2", "sub-3", "sub-4"],
  );
});
