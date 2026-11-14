// Prompt 38F, commit E: the one function that decides what a clip post shows.
//
// The feed card, the post page and their metadata all call buildClipCard, so
// these tests are the adult rule at its source: a masked clip has to come back
// carrying no code, no title, no anime and no range. Anything the masked shape
// does not carry cannot be drawn by a careless component later.

import assert from "node:assert/strict";
import test from "node:test";

import { buildClipCard, clipCardFor, clipPostHeadline } from "../clip-post";
import { ADULT_HIDDEN_TEXT, ADULT_LABEL } from "../clip-attachment";
import type { AnimeSummary, ClipRow } from "@/app/lib/clips/server";

const ROW = {
  id: "20000000-0000-4000-8000-000000000001",
  code: "abc2345",
  title: "  The best fight  ",
  anilist_id: 21,
  episode_number: 12,
  start_seconds: 62,
  end_seconds: 77,
} as unknown as ClipRow;

const ORDINARY = { title: "Frieren: Beyond Journey's End", isAdult: false } as unknown as AnimeSummary;
const ADULT = { title: "Adult Title", isAdult: true } as unknown as AnimeSummary;

test("a post with no clip is an ordinary post, whatever else it carries", () => {
  assert.deepEqual(clipCardFor(null, ROW, ORDINARY, true), { state: "none" });
  assert.deepEqual(clipCardFor(undefined, ROW, ORDINARY, true), { state: "none" });
  assert.deepEqual(clipCardFor("", ROW, ORDINARY, true), { state: "none" });
});

test("a clip code whose row is gone reads as removed, not as nothing", () => {
  assert.deepEqual(clipCardFor("abc2345", null, ORDINARY, true), { state: "removed" });
  assert.deepEqual(clipCardFor("abc2345", null, null, false), { state: "removed" });
});

test("an adult clip with the setting off carries nothing but the label", () => {
  const card = buildClipCard(ROW, ADULT, false);
  assert.equal(card.state, "hidden_adult");
  // The masked shape has no code at all: no link to follow, no poster to load.
  assert.deepEqual(Object.keys(card).sort(), ["label", "state", "text"]);
  assert.ok(!("code" in card), "a hidden adult card must not carry a clip code");
  assert.ok(!("animeTitle" in card), "a hidden adult card must not carry the anime name");
  assert.ok(!("start" in card), "a hidden adult card must not carry the range");
  assert.equal(card.state === "hidden_adult" && card.label, ADULT_LABEL);
  assert.equal(card.state === "hidden_adult" && card.text, ADULT_HIDDEN_TEXT);
  // And the two constants say what the owner asked for.
  assert.equal(ADULT_LABEL, "Adult content 18+");
});

test("the same adult clip is a normal clip once the setting is on", () => {
  const card = buildClipCard(ROW, ADULT, true);
  assert.equal(card.state, "live");
  assert.equal(card.state === "live" && card.isAdult, true);
  assert.equal(card.state === "live" && card.code, "abc2345");
});

test("an ordinary clip is live, with its title trimmed and its range kept", () => {
  const card = buildClipCard(ROW, ORDINARY, false);
  assert.deepEqual(card, {
    state: "live",
    code: "abc2345",
    title: "The best fight",
    animeTitle: "Frieren: Beyond Journey's End",
    anilistId: 21,
    episode: 12,
    start: 62,
    end: 77,
    isAdult: false,
  });
});

test("a blank title becomes null so the card can fall back to the anime name", () => {
  const blank = { ...ROW, title: "   " } as unknown as ClipRow;
  const card = buildClipCard(blank, ORDINARY, false);
  assert.equal(card.state === "live" && card.title, null);
});

test("a clip whose anime could not be read stays visible as an ordinary clip", () => {
  // An unknown anime must not hide a clip: hiding is the safe-looking choice
  // that would also hide every clip when the anime table is cold.
  const card = buildClipCard(ROW, null, false);
  assert.equal(card.state, "live");
  assert.equal(card.state === "live" && card.isAdult, false);
});

test("missing numbers fall back to zero instead of NaN in the label", () => {
  const sparse = { ...ROW, start_seconds: null, end_seconds: null } as unknown as ClipRow;
  const card = buildClipCard(sparse, ORDINARY, false);
  assert.equal(card.state === "live" && card.start, 0);
  assert.equal(card.state === "live" && card.end, 0);
});

test("the headline follows the state", () => {
  assert.equal(clipPostHeadline({ state: "none" }), "Shared a clip");
  assert.equal(clipPostHeadline({ state: "removed" }), "Shared a clip");
  assert.equal(
    clipPostHeadline({ state: "hidden_adult", label: ADULT_LABEL, text: ADULT_HIDDEN_TEXT }),
    ADULT_LABEL,
  );
  assert.equal(
    clipPostHeadline({
      state: "live",
      code: "abc2345",
      title: "The best fight",
      animeTitle: "Frieren",
      anilistId: 21,
      episode: 12,
      start: 62,
      end: 77,
      isAdult: false,
    }),
    "The best fight",
  );
  assert.equal(
    clipPostHeadline({
      state: "live",
      code: "abc2345",
      title: null,
      animeTitle: "Frieren",
      anilistId: 21,
      episode: 12,
      start: 62,
      end: 77,
      isAdult: false,
    }),
    "Frieren",
  );
});
