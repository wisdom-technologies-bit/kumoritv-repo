// Part B: one title rule everywhere.
//
// The helper matrix, the three-span render, search matching every name, and the
// preference round trip between localStorage, the profile and the cookie.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { render } from "../../test-harness/render";
import AnimeTitle from "@/app/lib/titles/AnimeTitle";
import {
  alternativeTitle,
  filterByTitleQuery,
  matchesTitleQuery,
  pickTitle,
  pickTitles,
  titleVariants,
  UNTITLED,
} from "@/app/lib/titles";
import { coerceTitleLanguage, normaliseTitleLanguage } from "@/app/lib/titles/language";
import { profileToPrefs, prefsToProfilePatch, readPrefs, setLocalPref } from "@/app/lib/user-data/prefs";

const TITLES = { romaji: "Shingeki no Kyojin", english: "Attack on Titan", native: "進撃の巨人" };

test("the fallback matrix covers every gap", () => {
  // The chosen language first.
  assert.equal(pickTitle(TITLES, "romaji"), "Shingeki no Kyojin");
  assert.equal(pickTitle(TITLES, "english"), "Attack on Titan");
  assert.equal(pickTitle(TITLES, "native"), "進撃の巨人");

  // preference -> english -> romaji -> native
  assert.equal(pickTitle({ romaji: "R", native: "N" }, "english"), "R", "english falls to romaji");
  assert.equal(pickTitle({ native: "N" }, "english"), "N", "then to native");
  assert.equal(pickTitle({ romaji: "R" }, "english"), "R");
  assert.equal(pickTitle({}, "english"), UNTITLED);
  assert.equal(pickTitle(null, "english"), UNTITLED);

  // native is special: an empty native string falls to romaji, not to English.
  assert.equal(pickTitle({ romaji: "R", english: "E" }, "native"), "R");
  assert.equal(pickTitle({ english: "E" }, "native"), "E", "no romaji either: English");

  // A plain string is accepted (flattened catalog rows).
  assert.equal(pickTitle("One Piece", "native"), "One Piece");

  // Whitespace is not a title.
  assert.equal(pickTitle({ english: "   ", romaji: "R" }, "english"), "R");

  // An unknown preference falls back to the default (English).
  assert.equal(pickTitle(TITLES, "klingon"), "Attack on Titan");
  assert.equal(pickTitle(TITLES, undefined), "Attack on Titan");
});

test("pickTitles and titleVariants agree with pickTitle", () => {
  const list = [TITLES, { romaji: "Bleach" }];

  assert.deepEqual(pickTitles(list, "native", (item) => item), ["進撃の巨人", "Bleach"]);
  assert.deepEqual(titleVariants(TITLES), {
    romaji: "Shingeki no Kyojin",
    english: "Attack on Titan",
    native: "進撃の巨人",
  });
});

test("the alternative title is the other name", () => {
  assert.equal(alternativeTitle(TITLES, "english"), "進撃の巨人", "English main, native second");
  assert.equal(alternativeTitle(TITLES, "romaji"), "進撃の巨人");
  assert.equal(alternativeTitle(TITLES, "native"), "Shingeki no Kyojin", "native main, romaji second");
  assert.equal(alternativeTitle({ romaji: "R" }, "english"), "R");
  assert.equal(alternativeTitle({}, "english"), "");
});

test("the language normaliser accepts AniList and KumoriTV spellings", () => {
  assert.equal(normaliseTitleLanguage("ROMAJI"), "romaji");
  assert.equal(normaliseTitleLanguage("NATIVE_STYLISED"), "native");
  assert.equal(normaliseTitleLanguage("English"), "english");
  assert.equal(normaliseTitleLanguage(" native "), "native");
  assert.equal(normaliseTitleLanguage("klingon"), null);
  assert.equal(coerceTitleLanguage(null), "english");
  assert.equal(coerceTitleLanguage("klingon", "romaji"), "romaji");
});

test("a title renders all three values, one span each", async () => {
  const tree = await render(<AnimeTitle titles={TITLES} />);

  try {
    const spans = [...tree.container.querySelectorAll("[data-title-lang]")];

    assert.deepEqual(
      spans.map((span) => span.getAttribute("data-title-lang")),
      ["romaji", "english", "native"]
    );
    assert.deepEqual(spans.map((span) => span.textContent), [
      "Shingeki no Kyojin",
      "Attack on Titan",
      "進撃の巨人",
    ]);
    assert.equal(spans[2].getAttribute("lang"), "ja", "the native span is marked Japanese");
    assert.equal(tree.container.querySelector("[data-anime-title]") !== null, true);
  } finally {
    await tree.unmount();
  }
});

test("the secondary line renders both candidates and lets CSS choose", async () => {
  const tree = await render(<AnimeTitle titles={TITLES} secondary />);

  try {
    const secondary = [...tree.container.querySelectorAll("[data-anime-title-secondary]")];

    assert.deepEqual(
      secondary.map((span) => [span.getAttribute("data-title-lang"), span.textContent]),
      [
        ["native", "進撃の巨人"],
        ["romaji", "Shingeki no Kyojin"],
      ]
    );
  } finally {
    await tree.unmount();
  }
});

test("search matches every title, whatever the preference", () => {
  assert.equal(matchesTitleQuery(TITLES, "attack"), true, "English");
  assert.equal(matchesTitleQuery(TITLES, "shingeki"), true, "romaji");
  assert.equal(matchesTitleQuery(TITLES, "進撃"), true, "native");
  assert.equal(matchesTitleQuery(TITLES, "ATTACK"), true, "case-insensitive");
  assert.equal(matchesTitleQuery(TITLES, "bleach"), false);
  assert.equal(matchesTitleQuery(TITLES, "   "), false, "an empty query matches nothing");

  assert.equal(
    matchesTitleQuery(TITLES, "aot", ["AoT", null, undefined]),
    true,
    "synonyms are searched too"
  );

  const filtered = filterByTitleQuery(
    [
      { id: 1, title: TITLES },
      { id: 2, title: { romaji: "Bleach" } },
    ],
    "進撃",
    (item) => item.title
  );

  assert.deepEqual(filtered.map((item) => item.id), [1]);
});

test("the preference round-trips through localStorage, the profile patch and the row", () => {
  setLocalPref("title_language", "native");

  try {
    assert.equal(readPrefs().title_language, "native");
  } finally {
    window.localStorage.removeItem("title_language");
  }

  // A user choice is marked so the AniList login never seeds over it.
  assert.deepEqual(prefsToProfilePatch("title_language", "romaji"), {
    title_language: "romaji",
    title_language_source: "user",
  });

  assert.equal(profileToPrefs({ title_language: "native" }).title_language, "native");
  assert.equal(profileToPrefs({ title_language: null }).title_language, "english", "default");
  assert.equal(profileToPrefs({ title_language: "klingon" }).title_language, "english", "junk is not trusted");
});
