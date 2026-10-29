import assert from "node:assert/strict";
import test from "node:test";
import {
  animeName,
  buildAudioPhrase,
  buildMediaDescription,
  buildMediaTitle,
  buildWatchCanonical,
  buildWatchDescription,
  buildWatchTitle,
  parseEpisodeNumber,
} from "../titles";

const LONG_NAME = "That Time I Got Reincarnated as a Slime Season Three Part Two";

test("watch title carries no brand and truncates long anime names first", () => {
  const title = buildWatchTitle({ animeName: "One Piece", episode: 1089, episodeTitle: "A New Era" });
  assert.equal(title, "Watch One Piece Episode 1089: A New Era");
  assert.ok(!title.includes("KumoriTV"));

  const long = buildWatchTitle({ animeName: LONG_NAME, episode: 12, episodeTitle: "The Meeting" });
  assert.ok(long.length <= 62, `${long.length}: ${long}`);
  assert.ok(long.startsWith("Watch "));
  assert.ok(long.includes("…"));
  assert.ok(long.includes("Episode 12"));
});

test("watch title drops a generic episode title", () => {
  assert.equal(
    buildWatchTitle({ animeName: "Bleach", episode: 5, episodeTitle: "Episode 5" }),
    "Watch Bleach Episode 5",
  );
  assert.equal(buildWatchTitle({ animeName: "Bleach", episode: 5, episodeTitle: "" }), "Watch Bleach Episode 5");
});

test("movies use the Movie title form and episode 1", () => {
  assert.equal(
    buildWatchTitle({ animeName: "Your Name", episode: 7, format: "MOVIE" }),
    "Watch Your Name (Movie)",
  );
  assert.equal(parseEpisodeNumber(7, "MOVIE"), 1);
});

test("watch description mentions audio only when available", () => {
  const sub = buildWatchDescription({
    animeName: "One Piece",
    episode: 1,
    episodeTitle: "Romance Dawn",
    hasSub: true,
    hasDub: false,
    synopsis: "<p>Pirates <b>arrive</b>.</p>",
  });
  assert.equal(sub, 'Watch One Piece Episode 1 "Romance Dawn" online with English subtitles. Pirates arrive.');

  const both = buildWatchDescription({
    animeName: "One Piece",
    episode: 1,
    episodeTitle: "Romance Dawn",
    hasSub: true,
    hasDub: true,
    synopsis: "",
  });
  assert.ok(both.includes("online with English subtitles and dubbed."));

  const none = buildWatchDescription({ animeName: "One Piece", episode: 1, hasSub: false, hasDub: false });
  assert.equal(none, "Watch One Piece Episode 1 online.");
  assert.equal(buildAudioPhrase(false, true), " and dubbed");
});

test("watch description falls back to the anime synopsis and stays at 160 chars", () => {
  const longSynopsis = "<p>" + "word ".repeat(200) + "</p>";
  const description = buildWatchDescription({
    animeName: LONG_NAME,
    episode: 1089,
    episodeTitle: "A Very Long Episode Title That Keeps Going And Going",
    hasSub: true,
    synopsis: longSynopsis,
  });
  assert.ok(description.length <= 160, `${description.length}: ${description}`);
  assert.ok(!description.includes("<"));
  assert.ok(description.includes("Episode 1089"));
});

test("canonical keeps only ?ep and normalises bad input", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  assert.equal(
    buildWatchCanonical(21, 5),
    "https://kumoritv.top/watch/21?ep=5",
  );
  // audio/t/lang/dub never reach the canonical because only the episode is read
  assert.equal(buildWatchCanonical("21", "5", "TV"), "https://kumoritv.top/watch/21?ep=5");
  assert.equal(buildWatchCanonical(21, "abc"), "https://kumoritv.top/watch/21?ep=1");
  assert.equal(buildWatchCanonical(21, 0), "https://kumoritv.top/watch/21?ep=1");
  assert.equal(buildWatchCanonical(21, -3), "https://kumoritv.top/watch/21?ep=1");
  assert.equal(buildWatchCanonical(21, undefined), "https://kumoritv.top/watch/21?ep=1");
  assert.equal(buildWatchCanonical(21, 9, "MOVIE"), "https://kumoritv.top/watch/21?ep=1");
  if (previous !== undefined) process.env.NEXT_PUBLIC_SITE_URL = previous;
});

test("media title and description", () => {
  assert.equal(
    buildMediaTitle({ animeName: "Frieren", year: 2023 }),
    "Frieren (2023) - Watch Online, Episodes & Info",
  );
  assert.equal(buildMediaTitle({ animeName: "Frieren" }), "Frieren - Watch Online, Episodes & Info");
  assert.ok(!buildMediaTitle({ animeName: "Frieren", year: 2023 }).includes("KumoriTV"));

  const description = buildMediaDescription({
    description: "<p>" + "The story of a mage. ".repeat(40) + "</p>",
    animeName: "Frieren",
  });
  assert.ok(description.length <= 160);
  assert.ok(!description.includes("<"));
  assert.equal(buildMediaDescription({ description: "", animeName: "Frieren" }).includes("Frieren"), true);
});

test("animeName prefers English then romaji", () => {
  assert.equal(animeName({ english: "Attack on Titan", romaji: "Shingeki no Kyojin" }), "Attack on Titan");
  assert.equal(animeName({ english: "", romaji: "Shingeki no Kyojin" }), "Shingeki no Kyojin");
  assert.equal(animeName({ romaji: "  ", native: "進撃の巨人" }), "進撃の巨人");
  assert.equal(animeName(null), "");
});
