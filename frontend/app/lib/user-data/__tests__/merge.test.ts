import assert from "node:assert/strict";
import test from "node:test";
import { FakeSupabaseClient } from "../../../../test-harness/fake-supabase";
import { createMemoryStorage } from "../storage";
import { GUEST_FAVOURITES_KEY } from "../favourites";
import { GUEST_LISTS_KEY } from "../lists";
import { GUEST_PROGRESS_KEY, mergeGuestDataIntoAccount, mergeMarkerKey } from "../merge";

const favourite = {
  id: 1,
  title: { romaji: "Frieren" },
  format: "TV",
  description: "",
  coverImage: { extraLarge: "xl.jpg", large: "l.jpg" },
};

const guestList = {
  "1": { id: 1, status: "watching", progress: 4, updatedAt: Date.parse("2026-10-10T10:00:00.000Z"), snapshot: favourite },
};

const guestProgress = {
  "1": { episode: 4, time: 600, duration: 1200, audio: "sub", updatedAt: Date.parse("2026-10-10T10:00:00.000Z"), watched: [1, 2, 4], title: "Frieren", cover: "c.jpg" },
};

function seedGuest(storage: ReturnType<typeof createMemoryStorage>, extra: Record<string, string> = {}) {
  storage.setItem(GUEST_FAVOURITES_KEY, JSON.stringify([favourite]));
  storage.setItem(GUEST_LISTS_KEY, JSON.stringify(guestList));
  storage.setItem(GUEST_PROGRESS_KEY, JSON.stringify(guestProgress));
  storage.setItem("autoSkip", "true");
  storage.setItem("autoNext", "false");
  storage.setItem("dubEpisodes", "true");
  storage.setItem("subtitle_language", "Portuguese");
  for (const [key, value] of Object.entries(extra)) storage.setItem(key, value);
}

function freshClient() {
  const client = new FakeSupabaseClient();
  client.tables.profiles = [
    { id: "user-1", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", auto_skip: false, auto_next: true, preferred_audio: "sub", subtitle_language: "English" },
  ];
  return client;
}

test("merges guest favourites, lists, progress and untouched preferences, then clears the guest keys", async () => {
  const client = freshClient();
  const storage = createMemoryStorage();
  seedGuest(storage);

  const result = await mergeGuestDataIntoAccount("user-1", { client: client as any, storage });

  assert.equal(result.merged, true);
  assert.equal(result.favourites, 1);
  assert.equal(result.lists, 1);
  assert.equal(result.prefs, true);

  assert.equal(client.rows("favourites").length, 1);
  assert.equal(client.rows("watchlist")[0].status, "watching");
  assert.equal(client.rows("watch_progress").length, 3);
  assert.equal(client.rows("profiles")[0].subtitle_language, "Portuguese");
  assert.equal(client.rows("profiles")[0].preferred_audio, "dub");

  // guest keys removed, progress cache (device resume) kept
  assert.equal(storage.getItem(GUEST_FAVOURITES_KEY), null);
  assert.equal(storage.getItem(GUEST_LISTS_KEY), null);
  assert.notEqual(storage.getItem(GUEST_PROGRESS_KEY), null);
  assert.equal(storage.getItem(mergeMarkerKey("user-1")), "1");
});

test("runs once per user per device", async () => {
  const client = freshClient();
  const storage = createMemoryStorage();
  seedGuest(storage);

  await mergeGuestDataIntoAccount("user-1", { client: client as any, storage });
  const writesAfterFirstRun = client.writes;

  const second = await mergeGuestDataIntoAccount("user-1", { client: client as any, storage });

  assert.equal(second.merged, false);
  assert.equal(second.reason, "already-merged");
  assert.equal(client.writes, writesAfterFirstRun);
});

test("newer updated_at wins over the server copy", async () => {
  const client = freshClient();
  client.tables.watchlist = [
    { user_id: "user-1", anilist_id: 1, status: "completed", progress: 28, snapshot: favourite, updated_at: "2026-09-01T10:00:00.000Z" },
  ];
  client.tables.watch_progress = [
    { user_id: "user-1", anilist_id: 1, episode_number: 4, position_seconds: 10, duration_seconds: 1200, audio: "sub", completed: false, snapshot: null, updated_at: "2026-09-01T10:00:00.000Z" },
  ];
  const storage = createMemoryStorage();
  seedGuest(storage);

  const result = await mergeGuestDataIntoAccount("user-1", { client: client as any, storage });

  assert.equal(result.merged, true);
  const list = client.rows("watchlist")[0];
  assert.equal(list.status, "watching");
  assert.equal(list.progress, 4);

  // the guest watched episode 4, so it merges as a completed row with its position
  const progressRow = client.rows("watch_progress").find((row) => row.episode_number === 4);
  assert.equal(progressRow?.position_seconds, 600);
  assert.equal(progressRow?.completed, true);
});

test("a failed upload keeps the guest data and does not mark the device as merged", async () => {
  const client = freshClient();
  client.failOn("favourites");
  const storage = createMemoryStorage();
  seedGuest(storage);

  const result = await mergeGuestDataIntoAccount("user-1", { client: client as any, storage });

  assert.equal(result.merged, false);
  assert.equal(result.reason, "error");
  assert.notEqual(storage.getItem(GUEST_FAVOURITES_KEY), null);
  assert.equal(storage.getItem(mergeMarkerKey("user-1")), null);
});

test("preferences are not overwritten when the profile was edited before", async () => {
  const client = freshClient();
  client.tables.profiles[0].updated_at = "2026-05-05T00:00:00.000Z";
  const storage = createMemoryStorage();
  seedGuest(storage);

  const result = await mergeGuestDataIntoAccount("user-1", { client: client as any, storage });

  assert.equal(result.merged, true);
  assert.equal(result.prefs, false);
  assert.equal(client.rows("profiles")[0].subtitle_language, "English");
});
