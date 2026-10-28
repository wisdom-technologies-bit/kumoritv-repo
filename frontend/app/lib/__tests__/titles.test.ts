import assert from "node:assert/strict";
import test from "node:test";
import { displayTitle, secondaryTitle, NOT_AVAILABLE } from "../titles";

// One fixture used across the whole prompt-13 suite: english, romaji and native
// all differ, and `userPreferred` carries the romaji value the way AniList fills
// it for anonymous requests.
export const FRIEREN_TITLE = {
  english: "Frieren: Beyond Journey's End",
  romaji: "Sousou no Frieren",
  native: "葬送のフリーレン",
  userPreferred: "Sousou no Frieren",
};

test("displayTitle prefers the english title", () => {
  assert.equal(displayTitle(FRIEREN_TITLE), "Frieren: Beyond Journey's End");
});

test("displayTitle ignores a romaji userPreferred", () => {
  assert.equal(displayTitle({ romaji: "Sousou no Frieren", userPreferred: "Sousou no Frieren" }), "Sousou no Frieren");
  assert.equal(
    displayTitle({ english: "Frieren", romaji: "Sousou no Frieren", userPreferred: "Sousou no Frieren" }),
    "Frieren",
  );
});

test("displayTitle falls back english -> romaji -> native -> userPreferred", () => {
  assert.equal(displayTitle({ romaji: "Sousou no Frieren", native: "葬送のフリーレン" }), "Sousou no Frieren");
  assert.equal(displayTitle({ native: "葬送のフリーレン", userPreferred: "Sousou no Frieren" }), "葬送のフリーレン");
  assert.equal(displayTitle({ userPreferred: "Sousou no Frieren" }), "Sousou no Frieren");
});

test("displayTitle treats null, empty and whitespace as missing", () => {
  const blanks = [null, undefined, "", "   ", "\n\t "];

  for (const blank of blanks) {
    assert.equal(displayTitle({ english: blank, romaji: null, native: undefined }), NOT_AVAILABLE);
  }

  assert.equal(displayTitle({ english: "   ", romaji: "Sousou no Frieren" }), "Sousou no Frieren");
  assert.equal(displayTitle({ english: "", romaji: "", native: "葬送のフリーレン" }), "葬送のフリーレン");
});

test("displayTitle returns the placeholder when nothing is available", () => {
  assert.equal(displayTitle({}), NOT_AVAILABLE);
  assert.equal(displayTitle(null), NOT_AVAILABLE);
  assert.equal(displayTitle(undefined), NOT_AVAILABLE);
  assert.equal(displayTitle(""), NOT_AVAILABLE);
  assert.equal(displayTitle("   "), NOT_AVAILABLE);
});

test("displayTitle trims every candidate it returns", () => {
  assert.equal(displayTitle({ english: "  Frieren  " }), "Frieren");
  assert.equal(displayTitle({ romaji: " Sousou no Frieren " }), "Sousou no Frieren");
  assert.equal(displayTitle({ native: " 葬送のフリーレン " }), "葬送のフリーレン");
  assert.equal(displayTitle({ userPreferred: " Sousou no Frieren " }), "Sousou no Frieren");
  assert.equal(displayTitle("  One Piece  "), "One Piece");
});

test("displayTitle accepts a plain string", () => {
  assert.equal(displayTitle("One Piece"), "One Piece");
  assert.equal(displayTitle(""), NOT_AVAILABLE);
});

test("secondaryTitle is the native title, romaji only as a fallback", () => {
  assert.equal(secondaryTitle(FRIEREN_TITLE), "葬送のフリーレン");
  assert.equal(secondaryTitle({ english: "Frieren", romaji: "Sousou no Frieren" }), "Sousou no Frieren");
  assert.equal(secondaryTitle({ native: "  ", romaji: "Sousou no Frieren" }), "Sousou no Frieren");
  assert.equal(secondaryTitle({ native: " 葬送のフリーレン " }), "葬送のフリーレン");
});

test("secondaryTitle is empty when there is nothing to show", () => {
  assert.equal(secondaryTitle({ english: "Frieren" }), "");
  assert.equal(secondaryTitle({}), "");
  assert.equal(secondaryTitle(null), "");
  assert.equal(secondaryTitle(undefined), "");
  assert.equal(secondaryTitle("One Piece"), "");
  assert.equal(secondaryTitle("   "), "");
});

test("secondaryTitle is hidden when it repeats the heading", () => {
  // The media page heading renders `displayTitle().toUpperCase()` and hides the
  // small line when the native title would only repeat it.
  const shouldShow = (title: Parameters<typeof displayTitle>[0]) => {
    const secondary = secondaryTitle(title);
    return secondary !== "" && secondary.toUpperCase() !== displayTitle(title).toUpperCase();
  };

  assert.equal(shouldShow(FRIEREN_TITLE), true);
  // Only a romaji title available: the fallback equals the heading, so no small line.
  assert.equal(shouldShow({ romaji: "Sousou no Frieren" }), false);
  // Native casing differences still count as the same title.
  assert.equal(shouldShow({ native: "one piece", english: "One Piece" }), false);
  // Nothing at all.
  assert.equal(shouldShow({}), false);
});
