// Turning a source series into mapping rows: numbers from titles, slugs from
// URLs, duplicates and unparseable rows skipped rather than guessed.

import assert from "node:assert/strict";
import test from "node:test";
import {
  episodeNumberFrom,
  planSeriesMapping,
  videoSlugFrom,
} from "@/app/lib/watch/adult/mapping";

test("episode numbers come from the title first", () => {
  assert.equal(episodeNumberFrom("Episode 3 Uncensored", ""), 3);
  assert.equal(episodeNumberFrom("Ep. 12", ""), 12);
  assert.equal(episodeNumberFrom("Episode 0", ""), 0);
});

test("the URL is the fallback", () => {
  assert.equal(
    episodeNumberFrom("Pilot", "https://watchhentai.net/videos/x-episode-7-uncensored-id-01/"),
    7,
  );
  assert.equal(episodeNumberFrom("Pilot", "https://watchhentai.net/videos/random/"), null);
});

test("video slugs come from the watch URL only", () => {
  assert.equal(
    videoSlugFrom("https://watchhentai.net/videos/hitori-tsuma-episode-1-id-01/"),
    "hitori-tsuma-episode-1-id-01",
  );
  assert.equal(videoSlugFrom("https://watchhentai.net/series/hitori-tsuma-id-01/"), null);
});

test("a whole run is planned in order, skipping what cannot be read", () => {
  const planned = planSeriesMapping([
    { title: "Episode 2", url: "https://watchhentai.net/videos/a-episode-2-id-01/" },
    { title: "Episode 1", url: "https://watchhentai.net/videos/a-episode-1-id-01/" },
    { title: "Episode 2 again", url: "https://watchhentai.net/videos/a-episode-2-id-01/" },
    { title: "Special", url: "https://watchhentai.net/series/a-id-01/" },
  ]);
  assert.deepEqual(planned, [
    { episode: 1, videoSlug: "a-episode-1-id-01", title: "Episode 1" },
    { episode: 2, videoSlug: "a-episode-2-id-01", title: "Episode 2" },
  ]);
});
