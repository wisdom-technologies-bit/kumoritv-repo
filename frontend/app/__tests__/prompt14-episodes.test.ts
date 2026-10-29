// C + D — episode metadata, the 1000-row cap, and the ani.pm-style list logic.

import assert from "node:assert/strict";
import test from "node:test";
import {
  EPISODE_CHUNK_SIZE,
  chunkEpisodes,
  episodeCounts,
  filterEpisodes,
  formatEpisodeDuration,
  mapEpisodeRows,
  nextEpisodeNumber,
  remainingLabel,
  visibleCount,
} from "@/app/lib/episodes/items";
import { selectAllEpisodeRows, EPISODE_PAGE_SIZE } from "@/app/lib/anime-db/queries";
import { mergeEpisodes } from "@/app/lib/anivexa/merge";

/** A fake Supabase client that honours `.range()` like PostgREST (max 1000). */
function fakeDb(total: number, cap = 1000) {
  const rows = Array.from({ length: total }, (_, i) => ({
    episode_number: i + 1,
    title: `Episode ${i + 1}`,
    description: null,
    image_url: null,
    air_date: null,
    duration: 1560,
    filler: false,
    recap: false,
    sub_providers: [{ provider: "anikoto", episodeId: "a" }],
    dub_providers: [],
  }));
  const requests: Array<{ from: number; to: number }> = [];
  const make = (from: number, to: number) => {
    const query: any = {
      eq: () => query,
      order: () => query,
      range: (a: number, b: number) => {
        requests.push({ from: a, to: b });
        return make(a, b);
      },
      then: (resolve: any) =>
        Promise.resolve({
          data: rows.slice(from, Math.min(to + 1, from + cap)),
          error: null,
        }).then(resolve),
    };
    return query;
  };
  return {
    requests,
    db: { from: () => ({ select: () => make(0, 999) }), rows },
  };
}

test("1100 episodes: every row comes back, in order", async () => {
  const { db, requests } = fakeDb(1100);
  const rows = await selectAllEpisodeRows(db, 21, "*");

  assert.equal(rows.length, 1100);
  assert.deepEqual(
    rows.map((row: any) => row.episode_number),
    Array.from({ length: 1100 }, (_, i) => i + 1),
  );
  // two pages: 0-999 then 1000-1999
  assert.deepEqual(
    requests.at(-2),
    { from: 0, to: EPISODE_PAGE_SIZE - 1 },
  );
  assert.deepEqual(requests.at(-1), { from: 1000, to: 1999 });
});

test("2300 episodes: three pages, nothing lost", async () => {
  const { db } = fakeDb(2300);
  const rows = await selectAllEpisodeRows(db, 21, "*");

  assert.equal(rows.length, 2300);
  assert.equal(rows[0].episode_number, 1);
  assert.equal(rows.at(-1).episode_number, 2300);
});

test("exactly 1000 rows needs a second (empty) page to stop", async () => {
  const { db, requests } = fakeDb(1000);
  const rows = await selectAllEpisodeRows(db, 21, "*");

  assert.equal(rows.length, 1000);
  assert.equal(requests.length, 2);
});

test("a client without .range() still works (returns what it gave)", async () => {
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({ order: async () => ({ data: [{ episode_number: 1 }], error: null }) }),
      }),
    }),
  };

  const rows = await selectAllEpisodeRows(db as any, 1, "*");
  assert.equal(rows.length, 1);
});

test("a full 2300 list survives mapping, filtering and searching", () => {
  const rows = Array.from({ length: 2300 }, (_, i) => ({
    episode_number: i + 1,
    title: i % 2 ? `Day ${i + 1}` : null,
    sub_providers: [{ provider: "anikoto", episodeId: "a" }],
    dub_providers: i % 3 === 0 ? [{ provider: "kaa", episodeId: "b" }] : [],
  }));
  const items = mapEpisodeRows(rows);

  assert.equal(items.length, 2300);

  const counts = episodeCounts(items);
  assert.equal(counts.total, 2300);
  assert.equal(counts.sub, 2300);
  assert.equal(counts.dub, 767);

  // search covers the FULL list, including numbers above 1000
  assert.deepEqual(
    filterEpisodes(items, { query: "1500" }).map((item) => item.number),
    [1500],
  );
  assert.equal(filterEpisodes(items, { query: "Day 1500" }).length, 1);
  assert.equal(filterEpisodes(items, { dubOnly: true }).length, 767);
  assert.equal(
    filterEpisodes(items, { hideWatched: true }, [1, 2, 3]).length,
    2297,
  );

  // jumping to episode 1500 works: it is inside the full sorted list
  const newest = filterEpisodes(items, { order: "desc" });
  assert.equal(newest[0].number, 2300);
  const index = newest.findIndex((item) => item.number === 1500);
  assert.equal(index, 2300 - 1500);
});

test("chunked rendering: 100 at a time, Show more grows the window", () => {
  assert.equal(EPISODE_CHUNK_SIZE, 100);
  assert.equal(chunkEpisodes(Array.from({ length: 250 })).length, 3);
  assert.equal(chunkEpisodes(Array.from({ length: 250 }))[2].length, 50);
  assert.equal(chunkEpisodes([], 100).length, 0);

  assert.equal(visibleCount(1100, 0), 100);
  assert.equal(visibleCount(1100, 4), 500);
  assert.equal(visibleCount(1100, 100), 1100);
  assert.equal(visibleCount(0, 3), 0);
});

test("episode metadata is mapped: title, description, image, air date, flags", () => {
  const [item] = mapEpisodeRows([
    {
      episode_number: 12,
      title: "The Battle",
      description: "A long synopsis.",
      image_url: "https://img.example/12.jpg",
      air_date: "2024-03-01",
      duration: 1560,
      filler: true,
      recap: true,
      sub_providers: [{ provider: "anikoto", episodeId: "a" }],
      dub_providers: [{ provider: "kaa", episodeId: "b" }],
    },
  ]);

  assert.deepEqual(item, {
    number: 12,
    title: "The Battle",
    description: "A long synopsis.",
    image: "https://img.example/12.jpg",
    airDate: "2024-03-01",
    duration: 1560,
    filler: true,
    recap: true,
    hasSub: true,
    hasDub: true,
  });
});

test("empty description / image / air date become null, so the line is hidden", () => {
  const [item] = mapEpisodeRows([
    { episode_number: 2, title: "  ", description: "", image_url: null, air_date: "" },
  ]);

  assert.equal(item.title, null);
  assert.equal(item.description, null);
  assert.equal(item.image, null);
  assert.equal(item.airDate, null);
});

test("AniVexa minutes become seconds and render as minutes, never seconds", () => {
  const rows = mergeEpisodes(
    {
      providers: {
        anikoto: {
          sub: [
            { id: "anikoto-1", number: 1, title: "One", duration: 26 },
          ],
          dub: [],
        },
      },
    } as any,
    21,
  );

  assert.equal(rows[0].duration, 1560);
  assert.equal(formatEpisodeDuration(rows[0].duration), "26m");
  assert.equal(formatEpisodeDuration(3720), "1h 2m");
  assert.equal(formatEpisodeDuration(null), "");
});

test("merge prefers the provider record that has description AND image", () => {
  const rows = mergeEpisodes(
    {
      providers: {
        // priority order puts reanime first, but it is missing the description
        reanime: { sub: [{ id: "reanime-1", number: 1, title: "A", image: "", description: "" }], dub: [] },
        anikoto: {
          sub: [
            {
              id: "anikoto-1",
              number: 1,
              title: "B",
              description: "Filled",
              image: "https://img.example/1.jpg",
              airDate: "2024-01-01",
            },
          ],
          dub: [],
        },
      },
    } as any,
    21,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].description, "Filled");
  assert.equal(rows[0].image_url, "https://img.example/1.jpg");
});

test("unknown providers are kept by the merge, appended after the known ones", () => {
  const rows = mergeEpisodes(
    {
      providers: {
        anizone: { sub: [{ id: "anizone-5", number: 5 }], dub: [] },
        brandnew: { sub: [{ id: "brandnew-5", number: 5 }], dub: [] },
      },
    } as any,
    21,
  );

  assert.equal(rows.length, 1);
  assert.deepEqual(
    rows[0].sub_providers.map((p) => p.provider),
    ["anizone", "brandnew"],
  );
});

test("next episode is capped at what has aired", () => {
  assert.equal(
    nextEpisodeNumber({ episode: 5, airedEpisodes: 8, totalEpisodes: 24 }),
    6,
  );
  assert.equal(
    nextEpisodeNumber({ episode: 8, airedEpisodes: 8, totalEpisodes: 24 }),
    null,
  );
  assert.equal(nextEpisodeNumber({ episode: 24, totalEpisodes: 24 }), null);
  assert.equal(nextEpisodeNumber({ episode: 1, format: "MOVIE" }), null);
  assert.equal(
    nextEpisodeNumber({ episode: 1100, totalEpisodes: 2300 }),
    1101,
  );
});

test("remaining time for the Keep Watching card", () => {
  assert.equal(remainingLabel(1200, 1560), "6m left");
  assert.equal(remainingLabel(1560, 1560), ""); // nothing left to show
  assert.equal(remainingLabel(10, null), "");
});
