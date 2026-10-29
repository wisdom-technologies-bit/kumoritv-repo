// E — Keep Watching snapshots, image fallback order and the resume link.

import assert from "node:assert/strict";
import test from "node:test";
import { normaliseProgressSnapshot } from "@/app/lib/user-data/normalise";
import { resolveImages, imageKey } from "@/app/lib/episodes/images";
import { watchHref } from "@/app/components/HomePage/KeepWatchingSection/components/KeepWatchingEpisodeInfo";
import { toKeepWatchingMediaData } from "@/app/lib/user-data/progress";
import type { KeepWatchingMediaData } from "@/app/ts/interfaces/firestoreData";

test("snapshot round-trip keeps title, cover and episodeImage", () => {
  const snapshot = {
    title: "One Piece",
    cover: "https://img.example/cover.jpg",
    episodeImage: "https://img.example/ep-12.jpg",
  };

  assert.deepEqual(normaliseProgressSnapshot(snapshot), snapshot);
});

test("a legacy string snapshot and a legacy {title, cover} still work", () => {
  assert.deepEqual(normaliseProgressSnapshot("One Piece"), {
    title: "One Piece",
    cover: null,
    episodeImage: null,
  });
  assert.deepEqual(normaliseProgressSnapshot({ title: "One Piece", cover: "c" }), {
    title: "One Piece",
    cover: "c",
    episodeImage: null,
  });
  assert.deepEqual(normaliseProgressSnapshot(null), {
    title: null,
    cover: null,
    episodeImage: null,
  });
});

test("image fallback order: episode thumbnail, then anime cover, then null", async () => {
  const requests = [
    { anilistId: 1, episode: 1 }, // has a thumbnail
    { anilistId: 1, episode: 2 }, // only the anime cover
    { anilistId: 2, episode: 1 }, // nothing: AniList cover
    { anilistId: 3, episode: 1 }, // nothing at all
  ];

  const result = await resolveImages(requests, {
    readEpisodeImages: async () => [
      { anilist_id: 1, episode_number: 1, image_url: "https://img.example/ep1.jpg" },
      { anilist_id: 1, episode_number: 2, image_url: "" },
    ],
    readAnimeCovers: async () => [
      { anilist_id: 1, cover_url: "https://img.example/cover1.jpg" },
      { anilist_id: 3, cover_url: null },
    ],
    readAniListCover: async (anilistId) =>
      anilistId === 2 ? "https://anilist.example/cover2.jpg" : null,
  });

  assert.equal(result[imageKey(1, 1)], "https://img.example/ep1.jpg");
  assert.equal(result[imageKey(1, 2)], "https://img.example/cover1.jpg");
  assert.equal(result[imageKey(2, 1)], "https://anilist.example/cover2.jpg");
  assert.equal(result[imageKey(3, 1)], null);
});

test("the episode lookup is ONE batched call for every card", async () => {
  let calls = 0;
  await resolveImages(
    [
      { anilistId: 5, episode: 1 },
      { anilistId: 6, episode: 3 },
      { anilistId: 7, episode: 9 },
    ],
    {
      readEpisodeImages: async (ids) => {
        calls += 1;
        assert.deepEqual(ids, [5, 6, 7]);
        return [];
      },
      readAnimeCovers: async () => [],
      readAniListCover: async () => "https://anilist.example/fallback.jpg",
    },
  );

  assert.equal(calls, 1);
});

test("the card link is /watch/{id}?ep=N&t=seconds&audio=...", () => {
  assert.equal(
    watchHref({
      id: 21,
      episode: 12,
      episodeTimeLastStop: 640.7,
      dub: true,
    } as unknown as KeepWatchingMediaData),
    "/watch/21?ep=12&t=640&audio=dub",
  );
  // no time yet: t is omitted, audio defaults to sub
  assert.equal(
    watchHref({ id: 21, episode: 1 } as unknown as KeepWatchingMediaData),
    "/watch/21?ep=1&audio=sub",
  );
  // legacy params are gone
  const href = watchHref({ id: 4, episode: 2, episodeTimeLastStop: 30 } as unknown as KeepWatchingMediaData);
  assert.ok(!/[?&](source|q|episode)=/.test(href), href);
});

test("the server row carries the episode image through to the card", () => {
  const card = toKeepWatchingMediaData({
    anilist_id: 21,
    episode_number: 3,
    position_seconds: 240,
    duration_seconds: 1560,
    audio: "dub",
    completed: false,
    snapshot: {
      title: "One Piece",
      cover: "https://img.example/cover.jpg",
      episodeImage: "https://img.example/ep3.jpg",
    },
    updated_at: new Date().toISOString(),
  } as any);

  assert.equal(card.episodeImg, "https://img.example/ep3.jpg");
  assert.equal(card.episodeDuration, 1560);
  assert.equal(card.dub, true);
  assert.equal(card.episode, "3");

  // an old row with no episode image falls back to the anime cover
  const legacy = toKeepWatchingMediaData({
    anilist_id: 22,
    episode_number: 1,
    position_seconds: 60,
    snapshot: { title: "Bleach", cover: "https://img.example/cover22.jpg" },
    updated_at: new Date().toISOString(),
  } as any);
  assert.equal(legacy.episodeImg, "https://img.example/cover22.jpg");
});
