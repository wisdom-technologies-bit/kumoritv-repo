import assert from "node:assert/strict";
import test from "node:test";
import { FakeSupabaseClient } from "../../../../test-harness/fake-supabase";
import {
  TOTAL_BUDGET_MS,
  episodeDurationToIso,
  getEpisodeSeo,
  minutesToIsoDuration,
  readEpisodeSeoRow,
  resolveEpisodeSeo,
  toAiredAtIso,
  type EpisodeSeoDeps,
  type EpisodeSeoRow,
  cleanEpisodeTitle,
} from "../episode-seo";

const MEDIA_ID = 21;

function seededClient() {
  return new FakeSupabaseClient({
    anime: [{ anilist_id: MEDIA_ID, title: "One Piece" }],
    episodes: [
      {
        play_id: `${MEDIA_ID}-1`,
        anilist_id: MEDIA_ID,
        episode_number: 1,
        title: "Romance Dawn",
        description: "<p>Luffy sets sail.</p>",
        image_url: "https://cdn.example/ep1.jpg",
        air_date: "1999-10-20",
        duration: 1440,
        sub_providers: [{ provider: "reanime", episodeId: "a" }],
        dub_providers: [],
      },
      {
        play_id: `${MEDIA_ID}-2`,
        anilist_id: MEDIA_ID,
        episode_number: 2,
        title: null,
        description: null,
        image_url: null,
        air_date: null,
        duration: null,
        sub_providers: [{ provider: "reanime", episodeId: "b" }],
        dub_providers: [{ provider: "animegg", episodeId: "c" }],
      },
    ],
    airing_episodes: [
      { anilist_id: MEDIA_ID, episode: 1, aired_at: "1999-10-20T11:30:00+00:00" },
    ],
  });
}

function deps(overrides: Partial<EpisodeSeoDeps> = {}): EpisodeSeoDeps {
  return {
    readEpisode: async () => null,
    importAnime: async () => ({ status: "ok" }),
    getMedia: async () => null,
    background: () => {},
    now: () => Date.now(),
    budgetMs: TOTAL_BUDGET_MS,
    ...overrides,
  };
}

test("AniList streaming titles lose their redundant episode prefix", () => {
  assert.equal(cleanEpisodeTitle("Episode 2 - The Great Swordsman", 2), "The Great Swordsman");
  assert.equal(cleanEpisodeTitle("Episode 12: Dog", 12), "Dog");
  assert.equal(cleanEpisodeTitle("EP. 7 | A Duel", 7), "A Duel");
  assert.equal(cleanEpisodeTitle("Episode 3", 3), "");
  assert.equal(cleanEpisodeTitle("Episode 12 - Dog", 2), "Episode 12 - Dog");
  assert.equal(cleanEpisodeTitle(null, 1), "");
});

test("duration conversions cover seconds, minutes and empty values", () => {
  assert.equal(episodeDurationToIso(1440), "PT24M");
  assert.equal(episodeDurationToIso(1500), "PT25M");
  assert.equal(episodeDurationToIso(90), "PT1M30S");
  assert.equal(episodeDurationToIso(5400), "PT1H30M");
  assert.equal(episodeDurationToIso(3660), "PT1H1M");
  assert.equal(episodeDurationToIso(24), "PT24M"); // a legacy minutes value
  assert.equal(episodeDurationToIso(45), "PT45M"); // below a minute can only be minutes
  assert.equal(episodeDurationToIso(0), null);
  assert.equal(episodeDurationToIso(null), null);
  assert.equal(episodeDurationToIso("nope"), null);
  assert.equal(minutesToIsoDuration(24), "PT24M");
  assert.equal(minutesToIsoDuration(null), null);
});

test("airing timestamps prefer full timestamps and fall back to UTC midnight", () => {
  assert.equal(toAiredAtIso("1999-10-20"), "1999-10-20T00:00:00+00:00");
  assert.equal(toAiredAtIso("1999-10-20T11:30:00+00:00"), "1999-10-20T11:30:00.000Z");
  assert.equal(toAiredAtIso(""), null);
  assert.equal(toAiredAtIso("not a date"), null);
});

test("DB hit: the episodes table answers with title, synopsis, duration and audio flags", async () => {
  const client = seededClient();
  const row = await readEpisodeSeoRow(client, MEDIA_ID, 1);
  assert.ok(row);
  assert.equal(row!.title, "Romance Dawn");
  assert.equal(row!.imageUrl, "https://cdn.example/ep1.jpg");
  assert.equal(row!.duration, 1440);
  assert.equal(row!.hasSub, true);
  assert.equal(row!.hasDub, false);
  assert.equal(row!.airedAtISO, new Date("1999-10-20T11:30:00+00:00").toISOString());

  const seo = await resolveEpisodeSeo(
    MEDIA_ID,
    1,
    deps({ readEpisode: (id, ep) => readEpisodeSeoRow(client, id, ep) }),
  );
  assert.equal(seo.source, "db");
  assert.equal(seo.episodeTitle, "Romance Dawn");
  assert.equal(seo.synopsis, "Luffy sets sail.");
  assert.equal(seo.thumbnailUrl, "https://cdn.example/ep1.jpg");
  assert.equal(seo.durationISO, "PT24M");
  assert.equal(seo.airedAtISO, new Date("1999-10-20T11:30:00+00:00").toISOString());
  assert.equal(seo.hasSub, true);
  assert.equal(seo.hasDub, false);
});

test("DB row without airing timestamp falls back to the date-only column", async () => {
  const client = new FakeSupabaseClient({
    episodes: [
      {
        anilist_id: MEDIA_ID,
        episode_number: 6,
        title: "The Test",
        description: "d",
        image_url: "i.jpg",
        air_date: "2020-01-02",
        duration: 1440,
        sub_providers: [],
        dub_providers: [{ provider: "x", episodeId: "y" }],
      },
    ],
  });
  const row = await readEpisodeSeoRow(client, MEDIA_ID, 6);
  assert.equal(row!.airedAtISO, "2020-01-02T00:00:00+00:00");
  assert.equal(row!.hasDub, true);
  assert.equal(row!.hasSub, false);
});

test("DB miss: AniList streamingEpisodes supplies title, thumbnail and synopsis", async () => {
  let importCalls = 0;
  const seo = await resolveEpisodeSeo(
    MEDIA_ID,
    2,
    deps({
      importAnime: async () => {
        importCalls += 1;
        return { status: "ok", episodes: 100 };
      },
      getMedia: async () => ({
        description: "<p>The Grand Line awaits.</p>",
        duration: 24,
        bannerImage: "https://cdn.example/banner.jpg",
        coverImage: { extraLarge: "https://cdn.example/cover.jpg" },
        streamingEpisodes: [
          { title: "Episode 1 - Romance Dawn", thumbnail: "https://cdn.example/s1.jpg" },
          { title: "Episode 2 - The Great Swordsman", thumbnail: "https://cdn.example/s2.jpg" },
          { title: "Episode 12 - Dog", thumbnail: "https://cdn.example/s12.jpg" },
        ],
      }),
    }),
  );
  assert.equal(importCalls, 1, "the import is still kicked off for the next visit");
  assert.equal(seo.source, "anilist");
  assert.equal(seo.episodeTitle, "The Great Swordsman");
  assert.equal(seo.thumbnailUrl, "https://cdn.example/s2.jpg");
  assert.equal(seo.synopsis, "The Grand Line awaits.");
  assert.equal(seo.durationISO, "PT24M");
  assert.equal(seo.airedAtISO, null);
});

test("DB miss: banner then cover fall back when no streaming thumbnail exists", async () => {
  const withBanner = await resolveEpisodeSeo(
    MEDIA_ID,
    3,
    deps({
      getMedia: async () => ({
        bannerImage: "https://cdn.example/banner.jpg",
        coverImage: { extraLarge: "https://cdn.example/cover.jpg" },
        streamingEpisodes: [],
      }),
    }),
  );
  assert.equal(withBanner.thumbnailUrl, "https://cdn.example/banner.jpg");
  assert.equal(withBanner.episodeTitle, "Episode 3");

  const coverOnly = await resolveEpisodeSeo(
    MEDIA_ID,
    3,
    deps({
      getMedia: async () => ({
        bannerImage: null,
        coverImage: { extraLarge: "https://cdn.example/cover.jpg" },
        streamingEpisodes: [],
      }),
    }),
  );
  assert.equal(coverOnly.thumbnailUrl, "https://cdn.example/cover.jpg");
  assert.equal(coverOnly.episodeTitle, "Episode 3");
});

test("slow dependencies still resolve inside the time budget", async () => {
  const never = () => new Promise<never>(() => {});
  const startedAt = Date.now();
  const seo = await resolveEpisodeSeo(
    MEDIA_ID,
    4,
    deps({
      readEpisode: never,
      importAnime: never,
      getMedia: never,
    }),
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed <= TOTAL_BUDGET_MS + 250, `took ${elapsed}ms`);
  assert.equal(seo.episodeTitle, "Episode 4");
  assert.equal(seo.source, "fallback");
});

test("never throws when every dependency fails", async () => {
  const boom = async () => {
    throw new Error("boom");
  };
  const failingBackground = () => {
    throw new Error("no waitUntil here");
  };
  const seo = await resolveEpisodeSeo(
    MEDIA_ID,
    5,
    deps({
      readEpisode: boom,
      importAnime: boom,
      getMedia: boom,
      background: failingBackground,
    }),
  );
  assert.deepEqual(seo, {
    episodeTitle: "Episode 5",
    synopsis: null,
    thumbnailUrl: null,
    airedAtISO: null,
    durationISO: null,
    hasSub: false,
    hasDub: false,
    source: "fallback",
  });
});

test("invalid ids short-circuit to the plain episode title", async () => {
  const seo = await getEpisodeSeo(Number.NaN, 2);
  assert.equal(seo.episodeTitle, "Episode 2");
  assert.equal(seo.source, "fallback");
});

test("getEpisodeSeo is importable and never throws without a database", async () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  const seo = await getEpisodeSeo(999999, 1);
  assert.equal(typeof seo.episodeTitle, "string");
  assert.ok(["db", "anilist", "fallback"].includes(seo.source));
  if (previous !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
});
