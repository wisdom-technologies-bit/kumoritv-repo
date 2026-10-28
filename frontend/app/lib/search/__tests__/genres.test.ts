import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMOGRAPHIC_TAG_OPTIONS,
  GENRE_OPTIONS,
  parseGenreParam,
  parseGenreSlugs,
  serializeGenreParam,
} from "../genres";

test("parses the bracket format every site link produces", () => {
  assert.deepEqual(parseGenreParam("[adventure]"), { genres: ["Adventure"], tags: [] });
  assert.deepEqual(parseGenreParam("[action-comedy]"), { genres: ["Action", "Comedy"], tags: [] });
  assert.deepEqual(parseGenreParam("[slice-of-life]"), { genres: ["Slice of Life"], tags: [] });
  assert.deepEqual(parseGenreParam("[slice-of-life-comedy]"), { genres: ["Slice of Life", "Comedy"], tags: [] });
  assert.deepEqual(parseGenreParam("[sci-fi]"), { genres: ["Sci-Fi"], tags: [] });
  assert.deepEqual(parseGenreParam("[sci-fi-mecha]"), { genres: ["Sci-Fi", "Mecha"], tags: [] });
  assert.deepEqual(parseGenreParam("[mahou-shoujo]"), { genres: ["Mahou Shoujo"], tags: [] });
});

test("parses bare, spaced, mixed-case and URL-encoded values", () => {
  assert.deepEqual(parseGenreParam("adventure"), { genres: ["Adventure"], tags: [] });
  assert.deepEqual(parseGenreParam("Adventure"), { genres: ["Adventure"], tags: [] });
  assert.deepEqual(parseGenreParam("slice of life"), { genres: ["Slice of Life"], tags: [] });
  assert.deepEqual(parseGenreParam("slice-of-life"), { genres: ["Slice of Life"], tags: [] });
  assert.deepEqual(parseGenreParam("Sci-Fi"), { genres: ["Sci-Fi"], tags: [] });
  assert.deepEqual(parseGenreParam("sci-fi"), { genres: ["Sci-Fi"], tags: [] });
  assert.deepEqual(parseGenreParam("mahou"), { genres: ["Mahou Shoujo"], tags: [] });
  assert.deepEqual(parseGenreParam("mahou shoujo"), { genres: ["Mahou Shoujo"], tags: [] });
  assert.deepEqual(parseGenreParam("%5Badventure%5D"), { genres: ["Adventure"], tags: [] });
  assert.deepEqual(parseGenreParam("%5Bslice%20of%20life%5D"), { genres: ["Slice of Life"], tags: [] });
  assert.deepEqual(parseGenreParam("  [ Adventure ]  "), { genres: ["Adventure"], tags: [] });
});

test("treats demographic values as AniList tags, not genres", () => {
  assert.deepEqual(parseGenreParam("[shoujo]"), { genres: [], tags: ["Shoujo"] });
  assert.deepEqual(parseGenreParam("[shounen]"), { genres: [], tags: ["Shounen"] });
  assert.deepEqual(parseGenreParam("shoujo"), { genres: [], tags: ["Shoujo"] });
  assert.deepEqual(parseGenreParam("Seinen"), { genres: [], tags: ["Seinen"] });
  assert.deepEqual(parseGenreParam("[josei]"), { genres: [], tags: ["Josei"] });
  assert.deepEqual(parseGenreParam("[kids]"), { genres: [], tags: ["Kids"] });
  assert.deepEqual(parseGenreParam("[shounen-drama]"), { genres: ["Drama"], tags: ["Shounen"] });
});

test("accepts repeated ?genre= arrays and mixes formats", () => {
  assert.deepEqual(parseGenreParam(["[action]", "comedy"]), { genres: ["Action", "Comedy"], tags: [] });
  assert.deepEqual(parseGenreParam(["[action]", "[comedy]", "[shoujo]"]), {
    genres: ["Action", "Comedy"],
    tags: ["Shoujo"],
  });
  assert.deepEqual(parseGenreParam([]), { genres: [], tags: [] });
});

test("ignores unknown values, keeps known ones and never invents a genre", () => {
  assert.deepEqual(parseGenreParam("[not-a-genre]"), { genres: [], tags: [] });
  assert.deepEqual(parseGenreParam("nonsense"), { genres: [], tags: [] });
  assert.deepEqual(parseGenreParam("[unknown-comedy]"), { genres: ["Comedy"], tags: [] });
  assert.deepEqual(parseGenreParam("[adventure-unknown]"), { genres: ["Adventure"], tags: [] });
  assert.deepEqual(parseGenreParam("[shounen]"), { genres: [], tags: ["Shounen"] });
});

test("removes duplicates and keeps the original order", () => {
  assert.deepEqual(parseGenreParam("[adventure-action-adventure]"), { genres: ["Adventure", "Action"], tags: [] });
  assert.deepEqual(parseGenreParam(["[adventure]", "Adventure", "%5Badventure%5D"]), {
    genres: ["Adventure"],
    tags: [],
  });
  assert.deepEqual(parseGenreParam("[mahou-mahou-shoujo]"), { genres: ["Mahou Shoujo"], tags: [] });
});

test("handles empty and missing input", () => {
  for (const value of [undefined, "", "[]", "[ ]", "   "] as Array<string | undefined>) {
    assert.deepEqual(parseGenreParam(value), { genres: [], tags: [] }, `for ${JSON.stringify(value)}`);
  }
});

test("parses to canonical slugs for the sidebar checkboxes", () => {
  assert.deepEqual(parseGenreSlugs("[slice-of-life-comedy]"), ["slice-of-life", "comedy"]);
  assert.deepEqual(parseGenreSlugs("[mahou-shoujo]"), ["mahou"]);
  assert.deepEqual(parseGenreSlugs("[shoujo]"), ["shoujo"]);
  assert.deepEqual(parseGenreSlugs(undefined), []);
});

test("serializes back to the bracket format the links use", () => {
  assert.equal(serializeGenreParam(["adventure"]), "[adventure]");
  assert.equal(serializeGenreParam(["action", "comedy"]), "[action-comedy]");
  assert.equal(serializeGenreParam(["slice-of-life", "comedy"]), "[slice-of-life-comedy]");
  assert.equal(serializeGenreParam(["sci-fi", "mecha"]), "[sci-fi-mecha]");
  assert.equal(serializeGenreParam(["shoujo"]), "[shoujo]");
  assert.equal(serializeGenreParam(["mahou-shoujo"]), "[mahou]");
  assert.equal(serializeGenreParam(["adventure", "adventure"]), "[adventure]");
  assert.equal(serializeGenreParam(["not-a-genre"]), "");
  assert.equal(serializeGenreParam([]), "");
});

test("parser and serializer round-trip for every known slug", () => {
  for (const { slug } of [...GENRE_OPTIONS, ...DEMOGRAPHIC_TAG_OPTIONS]) {
    const serialized = serializeGenreParam([slug]);
    const parsed = parseGenreParam(serialized);

    assert.equal(parsed.genres.length + parsed.tags.length, 1, `${slug} -> ${serialized}`);
    assert.equal(serializeGenreParam(parseGenreSlugs(serialized)), serialized, `${slug} round-trip`);
  }
});

test("every link value the site renders resolves to a canonical name", () => {
  // footer/header menus (app/data/animeGenres.json values)
  assert.deepEqual(parseGenreParam("[sci-fi]").genres, ["Sci-Fi"]);
  assert.deepEqual(parseGenreParam("[thriller]").genres, ["Thriller"]);
  // media page chip: genre.toLowerCase() of the AniList genre
  assert.deepEqual(parseGenreParam("[slice of life]").genres, ["Slice of Life"]);
  assert.deepEqual(parseGenreParam("[mahou shoujo]").genres, ["Mahou Shoujo"]);
  assert.deepEqual(parseGenreParam("[psychological]").genres, ["Psychological"]);
  // header manga menu genres (kept as-is, they still search anime)
  assert.deepEqual(parseGenreParam("[shounen]").tags, ["Shounen"]);
  assert.deepEqual(parseGenreParam("[drama]").genres, ["Drama"]);
});

test("exposes reusable option lists", () => {
  assert.deepEqual(GENRE_OPTIONS[0], { slug: "action", label: "Action" });
  assert.ok(GENRE_OPTIONS.some((option) => option.slug === "adventure" && option.label === "Adventure"));
  assert.ok(GENRE_OPTIONS.some((option) => option.slug === "slice-of-life" && option.label === "Slice of Life"));
  assert.equal(GENRE_OPTIONS.length, 19, "AniList has 19 genres");
  assert.deepEqual(
    DEMOGRAPHIC_TAG_OPTIONS.map((option) => option.slug),
    ["shoujo", "shounen", "seinen", "josei", "kids"],
  );
});
