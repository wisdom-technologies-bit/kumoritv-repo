// Prompt 15, part 1: Keep Watching merge, refresh wiring and save timing.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTINUE_WATCHING_MIN_SECONDS,
  mergeContinueWatchingLists,
  shouldMarkFirstSave,
  warnServerWriteFailureOnce,
} from "@/app/lib/user-data/progress";
import type { KeepWatchingMediaData } from "@/app/ts/interfaces/firestoreData";

const app = join(process.cwd(), "app");
const read = (path: string) => readFileSync(join(app, path), "utf8");

type Card = Partial<KeepWatchingMediaData> &
  Pick<KeepWatchingMediaData, "id" | "episode" | "episodeTimeLastStop" | "updatedAt">;

function card(overrides: Card): KeepWatchingMediaData {
  return {
    title: { userPreferred: `Anime ${overrides.id}`, romaji: `Anime ${overrides.id}` },
    coverImage: { extraLarge: `cover-${overrides.id}.jpg`, large: `cover-${overrides.id}.jpg` },
    episodeImg: `ep-${overrides.id}-${overrides.episode}.jpg`,
    episodeDuration: 1440,
    dub: false,
    ...overrides,
  } as unknown as KeepWatchingMediaData;
}

test("a guest / failed server write still shows the local entry", () => {
  const local = [card({ id: 21, episode: "3", episodeTimeLastStop: 120, updatedAt: 1_000 })];
  const merged = mergeContinueWatchingLists([], local);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 21);
  assert.equal(merged[0].episode, "3");
});

test("the newest copy wins, and artwork is never lost", () => {
  const local = [
    card({ id: 7, episode: "2", episodeTimeLastStop: 60, updatedAt: 5_000, episodeImg: "local.jpg" }),
  ];
  const server = [
    card({
      id: 7,
      episode: "4",
      episodeTimeLastStop: 900,
      updatedAt: 9_000,
      episodeImg: "",
      coverImage: undefined as unknown as KeepWatchingMediaData["coverImage"],
      title: undefined as unknown as KeepWatchingMediaData["title"],
    }),
  ];

  const serverWins = mergeContinueWatchingLists(server, local);
  assert.equal(serverWins.length, 1);
  assert.equal(serverWins[0].episode, "4");
  assert.equal(serverWins[0].episodeTimeLastStop, 900);
  // the server row had no art or title: the local copy fills them in
  assert.equal(serverWins[0].episodeImg, "local.jpg");
  assert.match(String(serverWins[0].title?.userPreferred), /Anime 7/);
  assert.equal(serverWins[0].coverImage?.extraLarge, "cover-7.jpg");

  // the other way round: a local save that is newer than the server row wins
  const newerLocal = [
    card({ id: 7, episode: "2", episodeTimeLastStop: 60, updatedAt: 12_000, episodeImg: "local.jpg" }),
  ];
  const localWins = mergeContinueWatchingLists(server, newerLocal);
  assert.equal(localWins[0].episode, "2");
  assert.equal(localWins[0].updatedAt, 12_000);
  assert.equal(localWins[0].episodeImg, "local.jpg");
});

test("short visits and finished episodes stay out, newest first, capped at 20", () => {
  const local = [
    card({ id: 1, episode: "1", episodeTimeLastStop: CONTINUE_WATCHING_MIN_SECONDS - 1, updatedAt: 10 }),
    card({ id: 2, episode: "1", episodeTimeLastStop: 1400, episodeDuration: 1440, updatedAt: 20 }),
    ...Array.from({ length: 25 }, (_, index) =>
      card({
        id: 100 + index,
        episode: "1",
        episodeTimeLastStop: 60,
        updatedAt: 100 + index,
      }),
    ),
  ];

  const merged = mergeContinueWatchingLists([], local);

  assert.equal(merged.length, 20, "capped at the continue-watching limit");
  assert.ok(!merged.some((item) => item.id === 1), "under 5s is dropped");
  assert.ok(!merged.some((item) => item.id === 2), "an almost-finished episode is dropped");
  assert.deepEqual(
    merged.map((item) => item.updatedAt),
    [...merged.map((item) => item.updatedAt)].sort((a, b) => Number(b) - Number(a)),
    "newest first",
  );
});

test("the first save is due once, as soon as playback passes 5s", () => {
  assert.equal(shouldMarkFirstSave(0, false), false);
  assert.equal(shouldMarkFirstSave(CONTINUE_WATCHING_MIN_SECONDS - 0.1, false), false);
  assert.equal(shouldMarkFirstSave(CONTINUE_WATCHING_MIN_SECONDS, false), true);
  assert.equal(shouldMarkFirstSave(120, false), true);
  assert.equal(shouldMarkFirstSave(120, true), false, "never saves twice for one episode");
});

test("a failing server write warns once per error code, not once per tick", () => {
  const originalWarn = console.warn;
  const calls: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    calls.push(args);
  };

  try {
    assert.equal(warnServerWriteFailureOnce({ code: "PGRST204", message: "column missing" }), true);
    assert.equal(warnServerWriteFailureOnce({ code: "PGRST204", message: "column missing" }), false);
    assert.equal(warnServerWriteFailureOnce({ code: "PGRST204", message: "column missing" }), false);
    assert.equal(calls.length, 1, "the same code logs once");

    assert.equal(warnServerWriteFailureOnce({ code: "42501", message: "rls" }), true);
    assert.equal(calls.length, 2, "a different code logs once more");
    assert.deepEqual(calls[0].slice(0, 2), ["[progress] server write failed", "column missing"]);
    assert.equal(calls[0][2], "PGRST204");
  } finally {
    console.warn = originalWarn;
  }
});

test("the player keeps cover and episodeImage in the snapshot deps and saves on ended", () => {
  const player = read("watch/[id]/components/VideoPlayer/index.tsx");

  const deps = player.match(/\}, \[anilistId, episode, audio, title[^\]]*\]\);/);
  assert.ok(deps, "the persist effect keeps its dependency list");
  assert.match(deps![0], /cover/);
  assert.match(deps![0], /episodeImage/);
  assert.match(player, /shouldMarkFirstSave\(/, "the 5s first save goes through the helper");
  assert.match(player, /onEnded=\{\(\) => \{[\s\S]*?persist\(\)/, "ending an episode saves");
});

test("the section loads for everyone and refreshes on return", () => {
  const section = read("components/HomePage/KeepWatchingSection/index.tsx");

  assert.ok(
    !/if \(user \|\| anilistUser\)/.test(section),
    "the load is not gated on a signed-in user",
  );
  assert.match(section, /useRefreshOnReturn\(getWatchingList\)/);
  assert.match(section, /knownImages/, "already-resolved images are reused");
});
