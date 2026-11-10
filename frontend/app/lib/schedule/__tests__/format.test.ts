// Prompt 33 Part B - what survives the feed and how a card reads.
import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeAiring,
  episodeLabel,
  filterAdultItems,
  filterSchedule,
  formatChip,
  isScheduleFormat,
  justReleased,
  prepareAiringSchedule,
  scheduleTitle,
  searchIndex,
  upNext,
  watchHref,
} from "@/app/lib/schedule/format";
import type { ScheduleItem } from "@/app/lib/schedule/types";

const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const NOW = at("2026-11-10T20:00:00Z");

function item(overrides: Partial<ScheduleItem> & { id?: number } = {}): ScheduleItem {
  return {
    id: overrides.id ?? 1,
    airingAt: overrides.airingAt ?? NOW + 3600,
    episode: overrides.episode ?? 5,
    available: overrides.available,
    media: {
      id: 21,
      title: { romaji: "One Piece", english: "One Piece", native: "ワンピース" },
      format: "TV",
      episodes: 1100,
      genres: ["Action", "Adventure", "Fantasy"],
      isAdult: false,
      averageScore: 88,
      studios: { nodes: [{ name: "Toei Animation" }] },
      ...overrides.media,
    },
  } as ScheduleItem;
}

test("only watchable formats are kept, MUSIC is not", () => {
  for (const format of ["TV", "TV_SHORT", "ONA", "MOVIE", "SPECIAL"]) {
    assert.equal(isScheduleFormat(format), true, format);
  }
  assert.equal(isScheduleFormat("MUSIC"), false);
  assert.equal(isScheduleFormat(null), false);
  assert.equal(isScheduleFormat(undefined), false);
});

test("adult titles follow the site setting", () => {
  const items = [item(), item({ media: { id: 2, isAdult: true } as never })];
  assert.equal(filterAdultItems(items, false).length, 1);
  assert.equal(filterAdultItems(items, true).length, 2);
});

test("a duplicated media+episode row is only listed once", () => {
  const items = [item({ id: 1 }), item({ id: 2 }), item({ id: 3, episode: 6 })];
  const deduped = dedupeAiring(items);
  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped.map((row) => row.episode), [5, 6]);
});

test("the prepared feed is sorted, deduped, adult-filtered and format-filtered", () => {
  const items = [
    item({ id: 1, airingAt: NOW + 7200, media: { id: 1 } as never }),
    item({ id: 2, airingAt: NOW + 3600, media: { id: 2 } as never }),
    item({ id: 3, airingAt: NOW + 3600, media: { id: 2 } as never }), // same media+episode as 2
    item({ id: 4, media: { id: 99, format: "MUSIC" } as never }),
    item({ id: 5, media: { id: 98, isAdult: true } as never }),
  ];
  const prepared = prepareAiringSchedule(items, { showAdultContent: false });
  assert.deepEqual(prepared.map((row) => row.airingAt), [NOW + 3600, NOW + 7200]);
  assert.equal(prepared.length, 2);
});

test("the card reads Episode N of M, and just Episode N when M is unknown", () => {
  assert.equal(episodeLabel(5, { episodes: 12 }), "Episode 5 of 12");
  assert.equal(episodeLabel(5, { episodes: null }), "Episode 5");
  assert.equal(episodeLabel(5, { episodes: 0 }), "Episode 5");
  assert.equal(episodeLabel(5, { episodes: 3 }), "Episode 5", "never 'of 3' for a 5th episode");
});

test("format chips are readable, titles follow the site rule", () => {
  assert.equal(formatChip("TV_SHORT"), "TV Short");
  assert.equal(formatChip("ONA"), "ONA");
  assert.equal(scheduleTitle({ title: { english: "Frieren", romaji: "Sousou no Frieren" } }), "Frieren");
  assert.equal(scheduleTitle({ title: { english: null, romaji: "Sousou no Frieren" } }), "Sousou no Frieren");
  assert.match(searchIndex(item().media), /one piece/);
  assert.match(searchIndex(item().media), /ワンピース/);
});

test("the search box matches any language of the title", () => {
  const items = [item(), item({ media: { id: 7, title: { english: "Dandadan", romaji: "Dandadan" } } as never })];
  assert.equal(filterSchedule(items, { query: "danda" }, { nowUnixSeconds: NOW }).length, 1);
  assert.equal(filterSchedule(items, { query: "ワンピ" }, { nowUnixSeconds: NOW }).length, 1);
  assert.equal(filterSchedule(items, { query: "nope" }, { nowUnixSeconds: NOW }).length, 0);
});

test("scope, format and hide-aired filters compose", () => {
  const items = [
    item({ id: 1, available: true, airingAt: NOW - 3600 }),
    item({ id: 2, available: false, media: { id: 8, format: "ONA" } as never }),
    item({ id: 3, available: true, media: { id: 9, format: "MOVIE" } as never }),
  ];
  const now = NOW;

  assert.equal(filterSchedule(items, { scope: "kumori" }, { nowUnixSeconds: now }).length, 2);
  assert.equal(filterSchedule(items, { formats: ["ONA"] }, { nowUnixSeconds: now }).length, 1);
  assert.equal(
    filterSchedule(items, { scope: "mylist" }, { nowUnixSeconds: now, myListIds: new Set([9]) }).length,
    1,
  );
  // Hide aired only applies to today.
  assert.equal(filterSchedule(items, { hideAired: true }, { nowUnixSeconds: now, onlyToday: true }).length, 2);
  assert.equal(filterSchedule(items, { hideAired: true }, { nowUnixSeconds: now, onlyToday: false }).length, 3);
});

test("up next is the six soonest, skipping what finished long ago", () => {
  const items = [
    item({ id: 1, airingAt: NOW - 7200 }),
    item({ id: 2, airingAt: NOW - 600 }), // 10 minutes in: still "airing now"
    ...Array.from({ length: 8 }, (_, index) => item({ id: 10 + index, airingAt: NOW + (index + 1) * 3600 })),
  ];
  const next = upNext(items, NOW, 6);
  assert.equal(next.length, 6);
  assert.equal(next[0]!.id, 2, "the one already airing comes first");
  assert.ok(next.every((row) => row.airingAt >= items[1]!.airingAt));
});

test("just released needs playable sources and the last 24 hours", () => {
  const items = [
    item({ id: 1, available: true, airingAt: NOW - 3600 }),
    item({ id: 2, available: true, airingAt: NOW - 90_000 }),
    item({ id: 3, available: false, airingAt: NOW - 3600 }),
  ];
  const released = justReleased(items, NOW, 8);
  assert.deepEqual(released.map((row) => row.id), [1]);
});

test("the watch link is the one the media page builds", () => {
  assert.equal(watchHref(21, 5), "/watch/21?episode=5");
});
